import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, codeFolding, foldGutter, foldKeymap } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';

const lightHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#0969da' },
  { tag: tags.string,       color: '#0a3069' },
  { tag: tags.number,       color: '#cf222e' },
  { tag: tags.bool,         color: '#8250df' },
  { tag: tags.null,         color: '#8250df' },
  { tag: tags.punctuation,  color: '#57606a' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#79c0ff' },
  { tag: tags.string,       color: '#a5d6ff' },
  { tag: tags.number,       color: '#ffa657' },
  { tag: tags.bool,         color: '#d2a8ff' },
  { tag: tags.null,         color: '#d2a8ff' },
  { tag: tags.punctuation,  color: '#8b949e' },
]);

const STRING_VALUE_RE = /"([^"]+)"\s*:\s*(?:\[(?:"[^"]*"\s*,\s*)*)?"([^"]*)$/;

const JsonCodeEditor = forwardRef(function JsonCodeEditor(
  { value, onChange, getCompletions, isDark },
  ref
) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const getCompletionsRef = useRef(getCompletions);
  onChangeRef.current = onChange;
  getCompletionsRef.current = getCompletions;

  // Autocomplete state: { options, from, partial, selectedIdx, left, top }
  const acRef = useRef(null);
  const [acState, setAcState] = useState(null);

  useImperativeHandle(ref, () => ({ getView: () => viewRef.current }));

  const hideAc = () => { acRef.current = null; setAcState(null); };

  const applyOption = (label) => {
    const ac = acRef.current;
    const view = viewRef.current;
    if (!ac || !view) return;
    const from = ac.from;
    let to = from + ac.partial.length;
    let insert = label;
view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    hideAc();
    view.focus();
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const tryShowCompletions = (view, state) => {
      const pos = state.selection.main.head;
      const before = state.doc.sliceString(0, pos);
      const result = getCompletionsRef.current?.(before);
      if (result) {
        const coords = view.coordsAtPos(pos);
        if (coords) {
          const data = {
            options: result.options,
            from: pos - result.partial.length,
            partial: result.partial,
            selectedIdx: 0,
            left: coords.left,
            top: coords.bottom + 4,
          };
          acRef.current = data;
          setAcState({ ...data });
          return;
        }
      }
      hideAc();
    };

    const docListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
        const isTyping = update.transactions.some(t => t.isUserEvent('input.type'));
        if (isTyping) {
          tryShowCompletions(update.view, update.state);
        }
      } else if (update.selectionSet) {
        tryShowCompletions(update.view, update.state);
      }
    });

    const acKeymap = keymap.of([
      {
        key: 'ArrowDown',
        run() {
          if (!acRef.current) return false;
          setAcState(s => s ? { ...s, selectedIdx: Math.min(s.selectedIdx + 1, s.options.length - 1) } : null);
          if (acRef.current) acRef.current.selectedIdx = Math.min(acRef.current.selectedIdx + 1, acRef.current.options.length - 1);
          return true;
        },
      },
      {
        key: 'ArrowUp',
        run() {
          if (!acRef.current) return false;
          setAcState(s => s ? { ...s, selectedIdx: Math.max(s.selectedIdx - 1, 0) } : null);
          if (acRef.current) acRef.current.selectedIdx = Math.max(acRef.current.selectedIdx - 1, 0);
          return true;
        },
      },
      {
        key: 'Enter',
        run() {
          const ac = acRef.current;
          if (!ac) return false;
          applyOption(ac.options[ac.selectedIdx]);
          return true;
        },
      },
      {
        key: 'Tab',
        run() {
          const ac = acRef.current;
          if (!ac) return false;
          applyOption(ac.options[ac.selectedIdx]);
          return true;
        },
      },
      {
        key: 'Escape',
        run() {
          if (!acRef.current) return false;
          hideAc();
          return true;
        },
      },
    ]);

    const extensions = [
      history(),
      drawSelection(),
      lineNumbers(),
      foldGutter(),
      codeFolding(),
      highlightActiveLine(),
      closeBrackets(),
      syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
      json(),
      acKeymap,
      keymap.of([...closeBracketsKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap, indentWithTab]),
      docListener,
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto', fontFamily: "'Consolas','Monaco','Courier New',monospace", fontSize: '12px' },
      }),
      isDark ? EditorView.theme({
        '&': { background: '#0d1117', color: '#c9d1d9' },
        '.cm-content': { caretColor: '#c9d1d9' },
        '.cm-cursor': { borderLeftColor: '#c9d1d9' },
        '.cm-gutters': { background: '#161b22', color: '#6e7681', borderRight: '1px solid #30363d' },
        '.cm-activeLine': { background: 'rgba(56,139,253,0.1)' },
        '.cm-activeLineGutter': { background: 'rgba(56,139,253,0.1)' },
        '.cm-selectionBackground, ::selection': { background: '#264f78 !important' },
        '.cm-foldPlaceholder': { background: '#30363d', color: '#8b949e', border: 'none' },
      }) : EditorView.theme({
        '.cm-foldPlaceholder': { background: '#f0f0f0', color: '#888', border: 'none' },
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: value ?? '{}', extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  // Sync external value
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value ?? '{}' } });
    }
  }, [value]);

  return (
    <>
      <div ref={containerRef} style={{ height: '100%' }} />
      {acState && acState.options.length > 0 && (
        <div
          className="rg-ac-dropdown"
          style={{ position: 'fixed', left: acState.left, top: acState.top, zIndex: 99999 }}
        >
          {acState.options.map((v, i) => (
            <div
              key={v}
              className={`rg-ac-item${i === acState.selectedIdx ? ' selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); applyOption(v); }}
            >
              {v}
            </div>
          ))}
        </div>
      )}
    </>
  );
});

export default JsonCodeEditor;
