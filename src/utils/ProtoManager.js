/* global chrome */

// Proto file manager using protobufjs
import protobuf from 'protobufjs';
import pako from 'pako';

const STORAGE_KEY = 'grpc_devtools_proto_files';
const STORAGE_KEY_ROOT = 'grpc_devtools_proto_root';
const STORAGE_KEY_IMPORT_PATH = 'grpc_devtools_proto_import_path';

class ProtoManager {
  constructor() {
    this.protoFiles = new Map(); // path -> content
    this.root = null;
    this.messageTypes = new Map(); // method name -> message type info
    this.importPath = ''; // user-configured import path for grpcurl
  }

  async initialize() {
    // Load from chrome.storage.local if available
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const result = await new Promise((resolve) => {
          chrome.storage.local.get([STORAGE_KEY, STORAGE_KEY_ROOT, STORAGE_KEY_IMPORT_PATH], resolve);
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

        if (result[STORAGE_KEY_IMPORT_PATH] != null) {
          this.importPath = result[STORAGE_KEY_IMPORT_PATH];
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

    // Auto-detect import path from the root directory of uploaded files.
    // With webkitdirectory upload, webkitRelativePath looks like:
    //   "shucle-proto/api/ridergw/v1/service.proto"
    // The first path segment ("shucle-proto") is the import root.
    const firstWithDir = files.find(f => f.webkitRelativePath && f.webkitRelativePath.includes('/'));
    if (firstWithDir) {
      const rootDir = firstWithDir.webkitRelativePath.split('/')[0];
      if (rootDir) {
        this.importPath = rootDir;
        console.log('[ProtoManager] Auto-detected import path:', rootDir);
      }
    } else {
      // Individual files uploaded — clear import path
      this.importPath = '';
    }

    // Build protobuf root
    await this.buildRoot();

    // Save to chrome.storage.local (includes importPath)
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

    // Pre-load google.protobuf well-known types so lookupType works correctly
    for (const definition of Object.values(googleProtoDefinitions)) {
      try {
        protobuf.parse(definition, this.root, { keepCase: true });
      } catch (e) {
        // Ignore - might already be loaded or have minor conflicts
      }
    }

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
    // Log top-level nested keys so we can detect any type accidentally registered at root
    const rootKeys = Object.keys(this.root.nested || {});
    console.log('[ProtoManager] Root namespaces:', rootKeys);
    // Warn if a bare message name (not a package namespace) ends up at the root level
    const suspectRootKeys = rootKeys.filter(k => /^[A-Z]/.test(k));
    if (suspectRootKeys.length) {
      console.warn('[ProtoManager] Unexpected top-level message types in root (should all be package namespaces):', suspectRootKeys);
    }
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
            [STORAGE_KEY_IMPORT_PATH]: this.importPath,
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
      // Note: importPath is intentionally kept across proto file clears
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

      // Look up request/response message types using service namespace context
      // to avoid picking the wrong type when multiple packages share the same short name
      const lookupFromService = (typeName) => {
        try {
          return service.lookupType(typeName);
        } catch (e) {
          return this.root.lookupType(typeName);
        }
      };
      const requestType = lookupFromService(method.requestType);
      const responseType = lookupFromService(method.responseType);

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
      // Proto field names are snake_case; JSON data may be camelCase — try both
      const camelFieldName = this.snakeToCamelCase(fieldName);
      const value = jsonData[fieldName] !== undefined ? jsonData[fieldName] : jsonData[camelFieldName];

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
    } else if (type === 'enum' || field.resolvedType instanceof protobuf.Enum
        || (() => { try { return !!this.root.lookupEnum(type); } catch (e) { return false; } })()) {
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

  snakeToCamelCase(str) {
    return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  }

  // Manual decode - decode protobuf bytes to JSON without using eval()
  manualDecode(messageType, bytes) {
    console.log('[ProtoManager] Manual decoding for type:', messageType.name, '| fullName:', messageType.fullName);

    try {
      // Use Reader to decode
      const reader = protobuf.Reader.create(bytes);
      const result = {};

      while (reader.pos < reader.len) {
        // Wrap each field in try-catch so one bad field doesn't abort the whole message
        let tag, fieldNumber, wireType;
        try {
          tag = reader.uint32();
        } catch (e) {
          console.error('[ProtoManager] Failed to read tag in', messageType.name, ':', e.message);
          break;
        }
        fieldNumber = tag >>> 3;
        wireType = tag & 7;

        // Find field by number - use fieldsById for O(1) lookup
        let field = messageType.fieldsById ? messageType.fieldsById[fieldNumber] : null;

        // Fallback: manual iteration (handles edge cases)
        if (!field) {
          for (const fn in messageType.fields) {
            if (messageType.fields[fn].id === fieldNumber) {
              field = messageType.fields[fn];
              break;
            }
          }
        }

        if (!field) {
          console.warn(`[ProtoManager] Unknown field number: ${fieldNumber} in ${messageType.name}`);
          try { reader.skipType(wireType); } catch (e) { break; }
          continue;
        }

        const fieldName = field.name;
        const camelFieldName = this.snakeToCamelCase(fieldName);

        // Packed repeated field detection:
        // Proto3 packs repeated varint/enum/bool fields as wireType 2 (length-delimited).
        // A field is "packed" when wireType=2 but the field's natural wire type is 0 (varint).
        const VARINT_TYPES = new Set(['int32','sint32','uint32','int64','sint64','uint64','bool','fixed32','sfixed32','fixed64','sfixed64']);
        const isVarintField = VARINT_TYPES.has(field.type) ||
          field.resolvedType instanceof protobuf.Enum ||
          (() => { try { return !!this.root.lookupEnum(field.type); } catch (e) { return false; } })();
        const isPacked = field.repeated && wireType === 2 && isVarintField;

        if (isPacked) {
          // Read all packed varint values from the length-delimited bytes
          if (!result[camelFieldName]) result[camelFieldName] = [];
          try {
            const packedBytes = reader.bytes();
            const packedReader = protobuf.Reader.create(packedBytes);
            let enumType = null;
            try { enumType = field.resolvedType instanceof protobuf.Enum
              ? field.resolvedType
              : this.root.lookupEnum(field.type); } catch (e) { /* not an enum */ }
            while (packedReader.pos < packedReader.len) {
              const raw = packedReader.int32();
              const resolved = enumType?.valuesById?.[raw] ?? raw;
              result[camelFieldName].push(resolved);
            }
          } catch (e) {
            console.warn(`[ProtoManager] Failed to read packed field ${fieldName}:`, e.message);
          }
          continue;
        }

        let value;
        try {
          value = this.readField(reader, field, wireType);
        } catch (e) {
          // For length-delimited fields (wire type 2), reader.bytes() already advanced the
          // outer reader before any internal error, so continue is safe.
          // For other wire types, the reader state may be unknown — log and stop.
          console.error(`[ProtoManager] Failed to read field ${fieldName} in ${messageType.name}:`, e.message);
          if (wireType === 2) continue;
          break;
        }

        // Handle map, repeated, and single fields
        if (field.map) {
          if (!result[camelFieldName]) result[camelFieldName] = {};
          if (value && value.__isMapEntry && value.key !== null) {
            result[camelFieldName][value.key] = value.value;
          }
        } else if (field.repeated) {
          if (!result[camelFieldName]) result[camelFieldName] = [];
          if (value && value.__packedFallback) {
            result[camelFieldName].push(...value.values);
          } else {
            result[camelFieldName].push(value);
          }
        } else {
          result[camelFieldName] = value;
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

    // Debug: log field info for non-primitive types
    if (!['string', 'int32', 'sint32', 'uint32', 'int64', 'sint64', 'uint64', 'bool', 'double', 'float', 'bytes', 'fixed32', 'sfixed32', 'fixed64', 'sfixed64'].includes(type)) {
      console.log('[ProtoManager] Field info:', {
        name: field.name,
        type: type,
        wireType: wireType,
        resolvedType: field.resolvedType,
        resolvedTypeName: field.resolvedType?.constructor?.name,
        isEnum: field.resolvedType instanceof protobuf.Enum
      });
    }

    // Handle map fields: map<K, V> is encoded as repeated length-delimited messages
    // with field 1 = key, field 2 = value
    if (field.map) {
      if (wireType !== 2) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      // reader.bytes() advances the outer reader past this map entry — must be called first
      const mapEntryBytes = reader.bytes();
      const mapReader = protobuf.Reader.create(mapEntryBytes);
      let mapKey = null;
      let mapValue = null;
      while (mapReader.pos < mapReader.len) {
        let mapTag;
        try { mapTag = mapReader.uint32(); } catch (e) { break; }
        const mapFieldNum = mapTag >>> 3;
        const mapWireType = mapTag & 7;
        try {
          if (mapFieldNum === 1) {
            const keyField = { type: field.keyType, map: false, repeated: false, resolvedType: null, name: '__mapKey__', id: 1 };
            mapKey = this.readField(mapReader, keyField, mapWireType);
          } else if (mapFieldNum === 2) {
            const valField = { type: field.type, map: false, repeated: false, resolvedType: field.resolvedType, name: '__mapValue__', id: 2 };
            mapValue = this.readField(mapReader, valField, mapWireType);
          } else {
            try { mapReader.skipType(mapWireType); } catch (e) { break; }
          }
        } catch (e) {
          console.warn('[ProtoManager] Map entry field error:', e.message);
          break;
        }
      }
      return { __isMapEntry: true, key: mapKey, value: mapValue };
    }

    // Wire type constants: 0=varint, 1=64-bit, 2=length-delimited, 5=32-bit
    // Validate wire type before reading to prevent reader corruption on type mismatches.
    // If wire type doesn't match the field's expected encoding, skip and return null.

    if (type === 'string') {
      if (wireType !== 2) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return reader.string();
    } else if (type === 'bytes') {
      if (wireType !== 2) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return reader.bytes();
    } else if (type === 'int32' || type === 'sint32') {
      if (wireType !== 0) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return reader.int32();
    } else if (type === 'uint32') {
      if (wireType !== 0) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return reader.uint32();
    } else if (type === 'int64' || type === 'sint64') {
      if (wireType !== 0) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      const longVal = reader.int64();
      const num = typeof longVal === 'object' && typeof longVal.toNumber === 'function'
        ? longVal.toNumber() : Number(String(longVal));
      return Number.isSafeInteger(num) ? num : String(longVal);
    } else if (type === 'uint64') {
      if (wireType !== 0) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      const longVal = reader.uint64();
      const num = typeof longVal === 'object' && typeof longVal.toNumber === 'function'
        ? longVal.toNumber() : Number(String(longVal));
      return Number.isSafeInteger(num) ? num : String(longVal);
    } else if (type === 'bool') {
      if (wireType !== 0) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return reader.bool();
    } else if (type === 'double') {
      if (wireType !== 1) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return reader.double();
    } else if (type === 'float') {
      if (wireType !== 5) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return reader.float();
    } else if (type === 'fixed64' || type === 'sfixed64') {
      if (wireType !== 1) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return type === 'fixed64' ? reader.fixed64().toString() : reader.sfixed64().toString();
    } else if (type === 'fixed32' || type === 'sfixed32') {
      if (wireType !== 5) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      return type === 'fixed32' ? reader.fixed32() : reader.sfixed32();
    } else if (type === 'enum' || field.resolvedType instanceof protobuf.Enum) {
      if (wireType !== 0) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
      const enumValue = reader.int32();
      try {
        const enumType = this.root.lookupEnum(field.type);
        if (enumType && enumType.valuesById) {
          return enumType.valuesById[enumValue] ?? enumValue;
        }
      } catch (e) { /* ignore */ }
      return enumValue;
    } else {
      // Try enum lookup first (handles cases where resolvedType is null)
      try {
        const enumType = this.root.lookupEnum(field.type);
        if (enumType) {
          if (wireType !== 0) { try { reader.skipType(wireType); } catch (e) { /* ignore */ } return null; }
          const enumValue = reader.int32();
          return enumType.valuesById?.[enumValue] ?? enumValue;
        }
      } catch (e) {
        // Not an enum, continue to message type handling
      }

      // Nested message type
      try {
        // Find primary nested type using parent namespace context
        let nestedType = null;
        try {
          nestedType = field.parent.lookupType(field.type);
        } catch (e) {
          try { nestedType = this.root.lookupType(field.type); } catch (e2) { /* not found */ }
        }

        // For fully-qualified type names (e.g. "commonv1.District"), also resolve
        // the short name in the parent's package (e.g. "webgwv1.District" when parent
        // is webgwv1.XXX). Used as fallback when the binary wireType mismatches the
        // primary schema — handles cases where the server returns a same-named but
        // structurally different message than what the proto import specifies.
        let fallbackType = null;
        const lastDot = field.type.lastIndexOf('.');
        if (lastDot >= 0) {
          const shortName = field.type.substring(lastDot + 1);
          try {
            const alt = field.parent.lookupType(shortName);
            if (alt && alt !== nestedType) fallbackType = alt;
          } catch (e) { /* not found in parent package */ }
        }

        if (nestedType) {
          if (wireType !== 2) {
            console.warn('[ProtoManager] Wire type mismatch for message field:', field.type, 'expected 2, got', wireType);
            try { reader.skipType(wireType); } catch (e) { /* ignore */ }
            return null;
          }
          const nestedBytes = reader.bytes();

          // Peek at the first tag in nestedBytes to detect schema mismatch.
          // If the primary type's expected wireType doesn't match the binary's,
          // but the fallback type does, switch to the fallback.
          if (fallbackType && nestedBytes.length > 0) {
            try {
              const peekedReader = protobuf.Reader.create(nestedBytes);
              const firstTag = peekedReader.uint32();
              const firstFieldNum = firstTag >>> 3;
              const firstWireType = firstTag & 7;

              const primaryField = nestedType.fieldsById?.[firstFieldNum];
              const fallbackField = fallbackType.fieldsById?.[firstFieldNum];

              if (primaryField && fallbackField) {
                const pft = primaryField.type;
                const isStr = pft === 'string' || pft === 'bytes';
                const isEnum = primaryField.resolvedType instanceof protobuf.Enum
                  || (() => { try { return !!this.root.lookupEnum(pft); } catch (e) { return false; } })();
                const isVarint = isEnum || ['int32','uint32','sint32','int64','uint64','sint64','bool'].includes(pft);
                const isMsg = !isStr && !isVarint && primaryField.resolvedType instanceof protobuf.Type;
                const expectedPrimaryWt = isStr || isMsg ? 2 : 0;

                if (firstWireType !== expectedPrimaryWt) {
                  const fft = fallbackField.type;
                  const fallbackIsStr = fft === 'string' || fft === 'bytes';
                  const fallbackIsMsg = !fallbackIsStr && fallbackField.resolvedType instanceof protobuf.Type;
                  const expectedFallbackWt = fallbackIsStr || fallbackIsMsg ? 2 : 0;
                  if (firstWireType === expectedFallbackWt) {
                    console.log('[ProtoManager] Binary wireType mismatch: switching from', nestedType.name, 'to fallback', fallbackType.name);
                    nestedType = fallbackType;
                  }
                }
              }
            } catch (e) { /* ignore peek errors */ }
          }

          const decoded = this.manualDecode(nestedType, nestedBytes);
          // If the message decoded to empty {} despite non-empty bytes, the binary
          // likely contains packed varints (e.g. "repeated Message" schema but server
          // sends packed enum/int32 values). Retry as packed int32 sequence.
          if (decoded !== null && Object.keys(decoded).length === 0 && nestedBytes.length > 0) {
            try {
              const pr = protobuf.Reader.create(nestedBytes);
              const packedVals = [];
              while (pr.pos < pr.len) {
                packedVals.push(pr.int32());
              }
              if (packedVals.length > 0) {
                return { __packedFallback: true, values: packedVals };
              }
            } catch (e) { /* ignore, fall through to returning decoded */ }
          }
          return decoded;
        } else {
          console.warn('[ProtoManager] Unknown message type:', field.type);
          try { reader.skipType(wireType); } catch (e) { /* ignore */ }
          return null;
        }
      } catch (e) {
        console.warn('[ProtoManager] Failed to lookup nested type:', field.type, e.message);
        try { reader.skipType(wireType); } catch (e2) { /* ignore */ }
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

  /**
   * Find the proto file that declares the package matching the given gRPC method.
   * e.g. method "https://host/opgwv1.OpGw/ListLines" → package "opgwv1"
   *      → searches proto file contents for "package opgwv1" → returns "api/opgw/v1/service.proto"
   * Returns the path relative to importPath (for use with -proto flag), or null if not found.
   */
  findProtoFileForMethod(methodName) {
    if (!methodName) return null;

    // Extract the path portion (strip scheme+host if present)
    let path = methodName;
    try {
      path = new URL(methodName).pathname;
    } catch (_) { /* not a full URL, use as-is */ }
    if (path.startsWith('/')) path = path.slice(1);

    // Package name is the part before the first dot: "opgwv1.OpGw/ListLines" → "opgwv1"
    const dotIdx = path.indexOf('.');
    if (dotIdx < 0) return null;
    const packageName = path.slice(0, dotIdx);
    if (!packageName) return null;

    const packagePattern = new RegExp(`\\bpackage\\s+${packageName}\\b`);
    const prefix = this.importPath ? this.importPath + '/' : '';

    for (const [filePath, content] of this.protoFiles.entries()) {
      if (packagePattern.test(content)) {
        // Strip the importPath prefix so the result is relative to -import-path
        return prefix && filePath.startsWith(prefix)
          ? filePath.slice(prefix.length)
          : filePath;
      }
    }

    return null; // no matching file found
  }

  isReady() {
    return this.root !== null && this.protoFiles.size > 0;
  }

  getStatus() {
    return {
      ready: this.isReady(),
      fileCount: this.protoFiles.size,
      files: Array.from(this.protoFiles.keys()),
      importPath: this.importPath,
    };
  }

  async setImportPath(path) {
    this.importPath = path;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY_IMPORT_PATH]: path }, resolve);
      });
    }
  }
}

// Singleton instance
const protoManager = new ProtoManager();

export default protoManager;
