/* global chrome */

// Proto file manager using protobufjs
import protobuf from 'protobufjs';
import pako from 'pako';

const STORAGE_KEY = 'grpc_devtools_proto_files';
const STORAGE_KEY_ROOT = 'grpc_devtools_proto_root';

class ProtoManager {
  constructor() {
    this.protoFiles = new Map(); // path -> content
    this.root = null;
    this.messageTypes = new Map(); // method name -> message type info
  }

  async initialize() {
    // Load from chrome.storage.local if available
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const result = await new Promise((resolve) => {
          chrome.storage.local.get([STORAGE_KEY, STORAGE_KEY_ROOT], resolve);
        });

        if (result[STORAGE_KEY]) {
          console.log('[ProtoManager] Loading cached proto files');
          const filesArray = result[STORAGE_KEY];
          filesArray.forEach(({ path, content }) => {
            this.protoFiles.set(path, content);
          });

          // Rebuild root from cached files
          await this.buildRoot();
        }
      } catch (error) {
        console.error('[ProtoManager] Failed to load from storage:', error);
      }
    }
  }

  async loadProtoFiles(files) {
    console.log('[ProtoManager] Loading from', files.length, 'files');

    // Clear existing files
    this.protoFiles.clear();

    // Filter and read proto files only
    let loadedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      // Use webkitRelativePath if available (directory upload), otherwise use name
      const path = file.webkitRelativePath || file.name;

      // Skip non-.proto files
      if (!path.endsWith('.proto')) {
        console.log('[ProtoManager] Skipping non-proto file:', path);
        skippedCount++;
        continue;
      }

      // Skip files in .git folder or other hidden folders
      if (path.includes('/.git/') || path.includes('\\.git\\') ||
          path.startsWith('.git/') || path.startsWith('.git\\')) {
        console.log('[ProtoManager] Skipping .git file:', path);
        skippedCount++;
        continue;
      }

      try {
        const content = await this.readFileAsText(file);
        this.protoFiles.set(path, content);
        console.log('[ProtoManager] Loaded:', path);
        loadedCount++;
      } catch (error) {
        console.error('[ProtoManager] Failed to read file:', path, error);
        skippedCount++;
      }
    }

    console.log('[ProtoManager] Loaded', loadedCount, 'proto files, skipped', skippedCount, 'files');

    if (loadedCount === 0) {
      throw new Error('No .proto files found in the selected directory');
    }

    // Build protobuf root
    await this.buildRoot();

    // Save to chrome.storage.local
    await this.saveToStorage();

    return this.protoFiles.size;
  }

  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async buildRoot() {
    console.log('[ProtoManager] Building protobuf root from', this.protoFiles.size, 'files');

    // Create a new root
    this.root = new protobuf.Root();

    // Track which google.protobuf files we've encountered
    const googleProtoImports = new Set();

    // Add custom resolver for imports
    this.root.resolvePath = (origin, target) => {
      console.log('[ProtoManager] Resolving:', origin, '->', target);

      // Handle google/protobuf imports - track but don't try to load
      if (target.startsWith('google/protobuf/')) {
        console.log('[ProtoManager] Tracking google/protobuf import:', target);
        googleProtoImports.add(target);
        return target; // Return the path but we'll handle it in fetch
      }

      // Try to find in loaded files
      // First try exact match
      if (this.protoFiles.has(target)) {
        return target;
      }

      // Try relative to origin
      if (origin) {
        const originDir = origin.substring(0, origin.lastIndexOf('/') + 1);
        const resolved = originDir + target;
        if (this.protoFiles.has(resolved)) {
          return resolved;
        }
      }

      // Try to find by filename
      for (const path of this.protoFiles.keys()) {
        if (path.endsWith('/' + target) || path === target) {
          return path;
        }
      }

      console.warn('[ProtoManager] Could not resolve:', target);
      return target;
    };

    // Google protobuf well-known types definitions (minimal set)
    const googleProtoDefinitions = {
      'google/protobuf/timestamp.proto': `
        syntax = "proto3";
        package google.protobuf;
        message Timestamp {
          int64 seconds = 1;
          int32 nanos = 2;
        }
      `,
      'google/protobuf/duration.proto': `
        syntax = "proto3";
        package google.protobuf;
        message Duration {
          int64 seconds = 1;
          int32 nanos = 2;
        }
      `,
      'google/protobuf/empty.proto': `
        syntax = "proto3";
        package google.protobuf;
        message Empty {}
      `,
      'google/protobuf/wrappers.proto': `
        syntax = "proto3";
        package google.protobuf;
        message DoubleValue { double value = 1; }
        message FloatValue { float value = 1; }
        message Int64Value { int64 value = 1; }
        message UInt64Value { uint64 value = 1; }
        message Int32Value { int32 value = 1; }
        message UInt32Value { uint32 value = 1; }
        message BoolValue { bool value = 1; }
        message StringValue { string value = 1; }
        message BytesValue { bytes value = 1; }
      `,
      'google/protobuf/struct.proto': `
        syntax = "proto3";
        package google.protobuf;
        message Struct {
          map<string, Value> fields = 1;
        }
        message Value {
          oneof kind {
            NullValue null_value = 1;
            double number_value = 2;
            string string_value = 3;
            bool bool_value = 4;
            Struct struct_value = 5;
            ListValue list_value = 6;
          }
        }
        enum NullValue {
          NULL_VALUE = 0;
        }
        message ListValue {
          repeated Value values = 1;
        }
      `,
      'google/protobuf/any.proto': `
        syntax = "proto3";
        package google.protobuf;
        message Any {
          string type_url = 1;
          bytes value = 2;
        }
      `,
      'google/protobuf/field_mask.proto': `
        syntax = "proto3";
        package google.protobuf;
        message FieldMask {
          repeated string paths = 1;
        }
      `,
      'google/protobuf/descriptor.proto': `
        syntax = "proto2";
        package google.protobuf;
        message FileDescriptorSet {
          repeated FileDescriptorProto file = 1;
        }
        message FileDescriptorProto {
          optional string name = 1;
          optional string package = 2;
          repeated string dependency = 3;
          repeated int32 public_dependency = 10;
          repeated int32 weak_dependency = 11;
          repeated DescriptorProto message_type = 4;
          repeated EnumDescriptorProto enum_type = 5;
          repeated ServiceDescriptorProto service = 6;
          repeated FieldDescriptorProto extension = 7;
          optional FileOptions options = 8;
          optional SourceCodeInfo source_code_info = 9;
          optional string syntax = 12;
        }
        message DescriptorProto {
          optional string name = 1;
          repeated FieldDescriptorProto field = 2;
          repeated FieldDescriptorProto extension = 6;
          repeated DescriptorProto nested_type = 3;
          repeated EnumDescriptorProto enum_type = 4;
          message ExtensionRange {
            optional int32 start = 1;
            optional int32 end = 2;
          }
          repeated ExtensionRange extension_range = 5;
          repeated OneofDescriptorProto oneof_decl = 8;
          optional MessageOptions options = 7;
          message ReservedRange {
            optional int32 start = 1;
            optional int32 end = 2;
          }
          repeated ReservedRange reserved_range = 9;
          repeated string reserved_name = 10;
        }
        message FieldDescriptorProto {
          enum Type {
            TYPE_DOUBLE = 1;
            TYPE_FLOAT = 2;
            TYPE_INT64 = 3;
            TYPE_UINT64 = 4;
            TYPE_INT32 = 5;
            TYPE_FIXED64 = 6;
            TYPE_FIXED32 = 7;
            TYPE_BOOL = 8;
            TYPE_STRING = 9;
            TYPE_GROUP = 10;
            TYPE_MESSAGE = 11;
            TYPE_BYTES = 12;
            TYPE_UINT32 = 13;
            TYPE_ENUM = 14;
            TYPE_SFIXED32 = 15;
            TYPE_SFIXED64 = 16;
            TYPE_SINT32 = 17;
            TYPE_SINT64 = 18;
          }
          enum Label {
            LABEL_OPTIONAL = 1;
            LABEL_REQUIRED = 2;
            LABEL_REPEATED = 3;
          }
          optional string name = 1;
          optional int32 number = 3;
          optional Label label = 4;
          optional Type type = 5;
          optional string type_name = 6;
          optional string extendee = 2;
          optional string default_value = 7;
          optional int32 oneof_index = 9;
          optional string json_name = 10;
          optional FieldOptions options = 8;
        }
        message OneofDescriptorProto {
          optional string name = 1;
          optional OneofOptions options = 2;
        }
        message EnumDescriptorProto {
          optional string name = 1;
          repeated EnumValueDescriptorProto value = 2;
          optional EnumOptions options = 3;
        }
        message EnumValueDescriptorProto {
          optional string name = 1;
          optional int32 number = 2;
          optional EnumValueOptions options = 3;
        }
        message ServiceDescriptorProto {
          optional string name = 1;
          repeated MethodDescriptorProto method = 2;
          optional ServiceOptions options = 3;
        }
        message MethodDescriptorProto {
          optional string name = 1;
          optional string input_type = 2;
          optional string output_type = 3;
          optional MethodOptions options = 4;
          optional bool client_streaming = 5;
          optional bool server_streaming = 6;
        }
        message FileOptions {
          optional string java_package = 1;
          optional string java_outer_classname = 8;
          optional bool java_multiple_files = 10;
          optional bool java_generate_equals_and_hash = 20;
          optional bool java_string_check_utf8 = 27;
          optional OptimizeMode optimize_for = 9;
          optional string go_package = 11;
          optional bool cc_generic_services = 16;
          optional bool java_generic_services = 17;
          optional bool py_generic_services = 18;
          optional bool deprecated = 23;
          optional bool cc_enable_arenas = 31;
          optional string objc_class_prefix = 36;
          optional string csharp_namespace = 37;
          repeated UninterpretedOption uninterpreted_option = 999;
          enum OptimizeMode {
            SPEED = 1;
            CODE_SIZE = 2;
            LITE_RUNTIME = 3;
          }
        }
        message MessageOptions {
          optional bool message_set_wire_format = 1;
          optional bool no_standard_descriptor_accessor = 2;
          optional bool deprecated = 3;
          optional bool map_entry = 7;
          repeated UninterpretedOption uninterpreted_option = 999;
        }
        message FieldOptions {
          optional CType ctype = 1;
          optional bool packed = 2;
          optional JSType jstype = 6;
          optional bool lazy = 5;
          optional bool deprecated = 3;
          optional bool weak = 10;
          repeated UninterpretedOption uninterpreted_option = 999;
          enum CType {
            STRING = 0;
            CORD = 1;
            STRING_PIECE = 2;
          }
          enum JSType {
            JS_NORMAL = 0;
            JS_STRING = 1;
            JS_NUMBER = 2;
          }
        }
        message OneofOptions {
          repeated UninterpretedOption uninterpreted_option = 999;
        }
        message EnumOptions {
          optional bool allow_alias = 2;
          optional bool deprecated = 3;
          repeated UninterpretedOption uninterpreted_option = 999;
        }
        message EnumValueOptions {
          optional bool deprecated = 1;
          repeated UninterpretedOption uninterpreted_option = 999;
        }
        message ServiceOptions {
          optional bool deprecated = 33;
          repeated UninterpretedOption uninterpreted_option = 999;
        }
        message MethodOptions {
          optional bool deprecated = 33;
          repeated UninterpretedOption uninterpreted_option = 999;
        }
        message UninterpretedOption {
          message NamePart {
            required string name_part = 1;
            required bool is_extension = 2;
          }
          repeated NamePart name = 2;
          optional string identifier_value = 3;
          optional uint64 positive_int_value = 4;
          optional int64 negative_int_value = 5;
          optional double double_value = 6;
          optional bytes string_value = 7;
          optional string aggregate_value = 8;
        }
        message SourceCodeInfo {
          repeated Location location = 1;
          message Location {
            repeated int32 path = 1;
            repeated int32 span = 2;
            optional string leading_comments = 3;
            optional string trailing_comments = 4;
            repeated string leading_detached_comments = 6;
          }
        }
      `,
    };

    // Add custom file reader
    this.root.fetch = (filename, callback) => {
      console.log('[ProtoManager] Fetching:', filename);

      // Check if it's a google/protobuf file
      if (filename && filename.startsWith('google/protobuf/')) {
        const definition = googleProtoDefinitions[filename];
        if (definition) {
          console.log('[ProtoManager] Using built-in definition for:', filename);
          callback(null, definition);
          return;
        } else {
          console.warn('[ProtoManager] No built-in definition for:', filename);
          callback(null, ''); // Return empty to avoid error
          return;
        }
      }

      const content = this.protoFiles.get(filename);
      if (content) {
        callback(null, content);
      } else {
        callback(new Error(`File not found: ${filename}`));
      }
    };

    // Load proto files one by one with better error handling
    const filePaths = Array.from(this.protoFiles.keys());

    console.log('[ProtoManager] Starting to parse', filePaths.length, 'proto files...');

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const filePath of filePaths) {
      try {
        console.log('[ProtoManager] Parsing:', filePath);
        const content = this.protoFiles.get(filePath);

        // Parse the file
        const parsed = protobuf.parse(content, this.root, { keepCase: true });

        if (parsed.package) {
          console.log('[ProtoManager] Parsed package:', parsed.package);
        }

        successCount++;
      } catch (error) {
        errorCount++;
        const errorMsg = `${filePath}: ${error.message}`;
        console.error('[ProtoManager] Failed to parse:', errorMsg);
        errors.push(errorMsg);

        // Don't fail completely, just skip this file
        if (errorCount > 10) {
          console.error('[ProtoManager] Too many errors, stopping');
          throw new Error(`Too many parse errors. First error: ${errors[0]}`);
        }
      }
    }

    console.log('[ProtoManager] Parse results:', successCount, 'success,', errorCount, 'errors');

    if (successCount === 0) {
      throw new Error('Failed to parse any proto files. Errors: ' + errors.slice(0, 3).join('; '));
    }

    if (errorCount > 0) {
      console.warn('[ProtoManager] Some files had errors:', errors);
    }

    console.log('[ProtoManager] Successfully built root with', successCount, 'files');
    console.log('[ProtoManager] Root namespaces:', Object.keys(this.root.nested || {}));
    console.log('[ProtoManager] Google protobuf imports used:', Array.from(googleProtoImports));
  }

  async saveToStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }

    try {
      // Convert Map to array for storage
      const filesArray = Array.from(this.protoFiles.entries()).map(([path, content]) => ({
        path,
        content,
      }));

      await new Promise((resolve, reject) => {
        chrome.storage.local.set(
          {
            [STORAGE_KEY]: filesArray,
          },
          () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          }
        );
      });

      console.log('[ProtoManager] Saved to storage');
    } catch (error) {
      console.error('[ProtoManager] Failed to save to storage:', error);
    }
  }

  async clearStorage() {
    this.protoFiles.clear();
    this.root = null;
    this.messageTypes.clear();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await new Promise((resolve) => {
        chrome.storage.local.remove([STORAGE_KEY, STORAGE_KEY_ROOT], resolve);
      });
      console.log('[ProtoManager] Cleared storage');
    }
  }

  getMessageType(methodName) {
    // methodName can be:
    // - "package.Service/Method" (clean format)
    // - "https://example.com:port/package.Service/Method" (URL format)

    if (!this.root) {
      console.error('[ProtoManager] Root not initialized');
      return null;
    }

    // Extract method path from URL if needed
    let cleanMethodName = methodName;
    if (methodName.startsWith('http://') || methodName.startsWith('https://')) {
      // URL format: https://example.com:port/package.Service/Method
      // Extract the path part after the domain
      try {
        const url = new URL(methodName);
        cleanMethodName = url.pathname.substring(1); // Remove leading /
        console.log('[ProtoManager] Extracted method from URL:', cleanMethodName);
      } catch (e) {
        console.error('[ProtoManager] Failed to parse URL:', methodName, e);
        return null;
      }
    }

    // Parse method name: "package.Service/Method"
    const parts = cleanMethodName.split('/');
    if (parts.length !== 2) {
      console.error('[ProtoManager] Invalid method name:', cleanMethodName);
      return null;
    }

    const servicePath = parts[0]; // e.g., "package.Service"
    const methodShortName = parts[1]; // e.g., "Method"

    console.log('[ProtoManager] Looking up method:', servicePath, methodShortName);

    try {
      // Look up service
      const service = this.root.lookup(servicePath);

      if (!service || !(service instanceof protobuf.Service)) {
        console.error('[ProtoManager] Service not found:', servicePath);
        return null;
      }

      console.log('[ProtoManager] Found service:', service.name);
      console.log('[ProtoManager] Service methods:', Object.keys(service.methods || {}));

      // Find method
      const method = service.methods[methodShortName];
      if (!method) {
        console.error('[ProtoManager] Method not found:', methodShortName);
        return null;
      }

      console.log('[ProtoManager] Found method:', method.name);
      console.log('[ProtoManager] Request type:', method.requestType);
      console.log('[ProtoManager] Response type:', method.responseType);

      // Look up request message type
      const requestType = this.root.lookupType(method.requestType);
      const responseType = this.root.lookupType(method.responseType);

      return {
        requestType,
        responseType,
        method,
      };
    } catch (error) {
      console.error('[ProtoManager] Failed to lookup message type:', error);
      return null;
    }
  }

  encodeMessage(methodName, jsonData) {
    const typeInfo = this.getMessageType(methodName);
    if (!typeInfo) {
      console.error('[ProtoManager] Cannot encode: message type not found');
      return null;
    }

    console.log('[ProtoManager] Request type:', typeInfo.requestType.name);
    console.log('[ProtoManager] JSON data to encode:', JSON.stringify(jsonData, null, 2));

    // Manual encoding to avoid CSP eval() issues
    // We'll use Writer directly without creating message objects
    try {
      const bytes = this.manualEncode(typeInfo.requestType, jsonData);
      if (bytes) {
        console.log('[ProtoManager] ✓ Manual encoding succeeded, size:', bytes.length);
        console.log('[ProtoManager] Encoded data preview:', Array.from(bytes.slice(0, 20)));
        return bytes;
      }
    } catch (error) {
      console.error('[ProtoManager] Manual encoding failed:', error);
    }

    console.error('[ProtoManager] All encoding attempts failed');
    return null;
  }

  manualEncode(messageType, jsonData) {
    const writer = protobuf.Writer.create();

    console.log('[ProtoManager] Manual encoding for type:', messageType.name);
    console.log('[ProtoManager] Fields:', Object.keys(messageType.fields || {}));

    // Iterate through all fields in the message type
    Object.keys(messageType.fields || {}).forEach(fieldName => {
      const field = messageType.fields[fieldName];
      const value = jsonData[fieldName];

      // Skip if value is not provided
      if (value === undefined || value === null) {
        return;
      }

      const fieldNumber = field.id;

      console.log(`[ProtoManager] Encoding field: ${fieldName} (${field.type}) = ${JSON.stringify(value)}`);

      try {
        // Handle different field types
        if (field.repeated) {
          // Repeated field
          if (Array.isArray(value)) {
            value.forEach(item => {
              this.writeField(writer, field, fieldNumber, item);
            });
          }
        } else {
          // Single field
          this.writeField(writer, field, fieldNumber, value);
        }
      } catch (err) {
        console.error(`[ProtoManager] Failed to encode field ${fieldName}:`, err);
      }
    });

    return writer.finish();
  }

  writeField(writer, field, fieldNumber, value) {
    const type = field.type;

    // Handle primitive types
    if (type === 'string') {
      writer.uint32((fieldNumber << 3) | 2).string(value);
    } else if (type === 'int32' || type === 'sint32') {
      writer.uint32((fieldNumber << 3) | 0).int32(value);
    } else if (type === 'uint32') {
      writer.uint32((fieldNumber << 3) | 0).uint32(value);
    } else if (type === 'int64' || type === 'sint64') {
      writer.uint32((fieldNumber << 3) | 0).int64(value);
    } else if (type === 'uint64') {
      writer.uint32((fieldNumber << 3) | 0).uint64(value);
    } else if (type === 'bool') {
      writer.uint32((fieldNumber << 3) | 0).bool(value);
    } else if (type === 'double') {
      writer.uint32((fieldNumber << 3) | 1).double(value);
    } else if (type === 'float') {
      writer.uint32((fieldNumber << 3) | 5).float(value);
    } else if (type === 'bytes') {
      writer.uint32((fieldNumber << 3) | 2).bytes(value);
    } else if (type === 'enum') {
      // Enum values are encoded as varints
      const enumValue = typeof value === 'string' ? this.getEnumValue(field, value) : value;
      writer.uint32((fieldNumber << 3) | 0).int32(enumValue);
    } else {
      // Nested message type
      const nestedType = this.root.lookupType(field.type);
      if (nestedType && typeof value === 'object') {
        const nestedBytes = this.manualEncode(nestedType, value);
        writer.uint32((fieldNumber << 3) | 2).bytes(nestedBytes);
      } else {
        console.warn('[ProtoManager] Unknown field type:', type);
      }
    }
  }

  getEnumValue(field, stringValue) {
    // Try to resolve enum value
    try {
      const enumType = this.root.lookupEnum(field.type);
      if (enumType && enumType.values) {
        return enumType.values[stringValue] || 0;
      }
    } catch (e) {
      console.warn('[ProtoManager] Could not resolve enum:', field.type);
    }
    return 0;
  }

  // Manual decode - decode protobuf bytes to JSON without using eval()
  manualDecode(messageType, bytes) {
    console.log('[ProtoManager] Manual decoding for type:', messageType.name);

    try {
      // Use Reader to decode
      const reader = protobuf.Reader.create(bytes);
      const result = {};

      while (reader.pos < reader.len) {
        const tag = reader.uint32();
        const fieldNumber = tag >>> 3;
        const wireType = tag & 7;

        // Find field by number
        let field = null;
        for (const fieldName in messageType.fields) {
          if (messageType.fields[fieldName].id === fieldNumber) {
            field = messageType.fields[fieldName];
            break;
          }
        }

        if (!field) {
          console.warn('[ProtoManager] Unknown field number:', fieldNumber);
          reader.skipType(wireType);
          continue;
        }

        const fieldName = field.name;
        const value = this.readField(reader, field, wireType);

        // Handle repeated fields
        if (field.repeated) {
          if (!result[fieldName]) {
            result[fieldName] = [];
          }
          result[fieldName].push(value);
        } else {
          result[fieldName] = value;
        }
      }

      console.log('[ProtoManager] ✓ Manual decode succeeded:', result);
      return result;
    } catch (error) {
      console.error('[ProtoManager] Manual decode failed:', error);
      return null;
    }
  }

  readField(reader, field, wireType) {
    const type = field.type;

    // Primitive types
    if (type === 'string') {
      return reader.string();
    } else if (type === 'int32' || type === 'sint32') {
      return reader.int32();
    } else if (type === 'uint32') {
      return reader.uint32();
    } else if (type === 'int64' || type === 'sint64') {
      return reader.int64().toString();
    } else if (type === 'uint64') {
      return reader.uint64().toString();
    } else if (type === 'bool') {
      return reader.bool();
    } else if (type === 'double') {
      return reader.double();
    } else if (type === 'float') {
      return reader.float();
    } else if (type === 'bytes') {
      return reader.bytes();
    } else if (type === 'enum') {
      const enumValue = reader.int32();
      // Try to find enum name
      try {
        const enumType = this.root.lookupEnum(field.type);
        if (enumType && enumType.valuesById) {
          return enumType.valuesById[enumValue] || enumValue;
        }
      } catch (e) {
        // Return numeric value if can't resolve
      }
      return enumValue;
    } else {
      // Nested message type
      const nestedType = this.root.lookupType(field.type);
      if (nestedType) {
        const nestedBytes = reader.bytes();
        return this.manualDecode(nestedType, nestedBytes);
      } else {
        console.warn('[ProtoManager] Unknown message type:', field.type);
        reader.skipType(wireType);
        return null;
      }
    }
  }

  // Build gRPC-web frame
  // gRPC-web format: [1 byte flags][4 bytes message length][message bytes]
  buildGrpcWebFrame(messageBytes, compress = false) {
    let payload = messageBytes;
    let compressionFlag = 0;

    // Compress if requested
    if (compress) {
      console.log('[ProtoManager] Compressing message with gzip, original size:', messageBytes.length);
      payload = pako.gzip(messageBytes);
      compressionFlag = 1; // 1 = compressed
      console.log('[ProtoManager] Compressed size:', payload.length);
    }

    const frame = new Uint8Array(5 + payload.length);

    // Byte 0: flags (0 = uncompressed, 1 = compressed)
    frame[0] = compressionFlag;

    // Bytes 1-4: message length (big-endian)
    const length = payload.length;
    frame[1] = (length >> 24) & 0xff;
    frame[2] = (length >> 16) & 0xff;
    frame[3] = (length >> 8) & 0xff;
    frame[4] = length & 0xff;

    // Bytes 5+: message
    frame.set(payload, 5);

    return frame;
  }

  isReady() {
    return this.root !== null && this.protoFiles.size > 0;
  }

  getStatus() {
    return {
      ready: this.isReady(),
      fileCount: this.protoFiles.size,
      files: Array.from(this.protoFiles.keys()),
    };
  }
}

// Singleton instance
const protoManager = new ProtoManager();

export default protoManager;
