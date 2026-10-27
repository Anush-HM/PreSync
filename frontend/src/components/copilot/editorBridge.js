// The narrow view of the editor the Copilot panel works through: the
// shared Y.Doc and undo history, the live Fabric canvas for measuring
// text and reading the text selection, and a way to end in-place text
// editing before a change lands. Built once by EditorPage from its refs.

export function createEditorBridge({ fabricRef, yjsRef, undoRef, scaleRef }) {
  let lastSelection = null;

  function readSelection(obj) {
    if (!obj || obj.type !== 'textbox' || !obj.isEditing || !obj.data?.blockId || obj.data.kind === 'table') return null;
    const start = Math.min(obj.selectionStart, obj.selectionEnd);
    const end = Math.max(obj.selectionStart, obj.selectionEnd);
    if (!(end > start)) return null;
    const text = Array.from(obj.text || '').slice(start, end).join('');
    return text.trim() ? { blockId: obj.data.blockId, start, end, text } : null;
  }

  return {
    getDoc: () => yjsRef.current?.doc ?? null,
    getUndoManager: () => undoRef.current ?? null,

    // Ends in-place editing so the canvas shows the change, as Undo does.
    releaseCanvas() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    },

    // Rendered heights of the active slide's blocks, in slide units.
    measureBlocks() {
      const canvas = fabricRef.current;
      const out = new Map();
      if (!canvas) return out;
      const scale = scaleRef.current || 1;
      canvas.getObjects().forEach((o) => {
        if (!o.data?.blockId || o.group) return;
        const h = (o.height || 0) * (o.scaleY || 1);
        if (Number.isFinite(h) && h > 0) out.set(o.data.blockId, { height: h / scale });
      });
      return out;
    },

    // The characters selected inside a text box being edited, or the
    // last such selection while the user moved over to the panel.
    textSelection() {
      return readSelection(fabricRef.current?.getActiveObject()) || lastSelection;
    },

    // Calls back whenever the canvas selection changes. Returns an unsubscribe.
    subscribe(cb) {
      const canvas = fabricRef.current;
      if (!canvas) return () => {};
      const onText = (e) => {
        const sel = readSelection(e.target);
        if (sel) lastSelection = sel;
        cb();
      };
      const onCleared = () => {
        lastSelection = null;
        cb();
      };
      const onChanged = () => {
        const active = canvas.getActiveObject();
        if (lastSelection && active?.data?.blockId !== lastSelection.blockId) lastSelection = null;
        cb();
      };
      canvas.on('text:selection:changed', onText);
      canvas.on('selection:cleared', onCleared);
      canvas.on('selection:created', onChanged);
      canvas.on('selection:updated', onChanged);
      canvas.on('text:changed', onCleared);
      return () => {
        canvas.off('text:selection:changed', onText);
        canvas.off('selection:cleared', onCleared);
        canvas.off('selection:created', onChanged);
        canvas.off('selection:updated', onChanged);
        canvas.off('text:changed', onCleared);
      };
    }
  };
}
