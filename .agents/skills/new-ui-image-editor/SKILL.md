---
name: new-ui-image-editor
description: Architecture and patterns for the React frontend's image editor in frontend/src/editor. Use when adding or changing editor tools, layers, or the editor's generation wiring.
---

# New UI Image Editor

Guide to the image editor of the React frontend (`frontend/`). For the equivalent in the existing
browser UI see [image-editor-tools](../image-editor-tools/SKILL.md), which this was ported from.

## When to Use

- Adding or modifying a tool in the new frontend's editor
- Working with its layers, undo history, or export paths
- Changing how the editor feeds `initimage` / `maskimage` into a generation

## Architecture

The editor is split in two: an imperative engine that owns the canvas, and React components that
own everything around it. The split exists because a brush stroke is not a diffable thing - React
would gain nothing from re-rendering sixty times a second - while the toolbar, layer list and
option bar are ordinary UI and benefit from every React affordance.

### Engine (`frontend/src/editor/`)

- `engine.ts` - `ImageEditorEngine`: view transform, layer list, undo stack, pointer/keyboard
  dispatch, rendering, and the export paths (`getFinalImageData`, `getFinalMaskData`,
  `getMaximumImageData`, `getImageWithBounds`, `exportForGeneration`).
- `layer.ts` - `EditorLayer`: a backing canvas at its own native resolution, placed into image
  space by offset / display size / rotation. `childLayers` are live buffers for in-progress
  strokes. Never replace `layer.canvas` with a new element - the layer panel shows that exact
  element as its live thumbnail.
- `history.ts` - undo entries. `layer_canvas_edit` holds a full-resolution copy, which is why the
  stack is bounded.
- `store.ts` - the zustand store: open/closed, plus `useEditorVersion()` and `editorOverrides()`.
- `types.ts` - `ToolOption` descriptors, `pressureOf`.
- `color.ts` - hex/RGB/greyscale conversions.

Three coordinate spaces, and mixing them up is the usual source of bugs:

- **screen** - CSS pixels within the canvas element (`engine.pointerX`, `viewWidth`)
- **image** - the document's own space, where the output rectangle is `realWidth × realHeight`
- **layer** - one layer's backing pixels

Convert with `canvasCoordToImageCoord` / `imageCoordToCanvasCoord` on the engine and
`canvasCoordToLayerCoord` / `layerCoordToCanvasCoord` / `setImageSpaceTransform` on the layer.
The backing store is sized in device pixels, so anything calling `getImageData` on the *view*
canvas has to scale by `engine.devicePixel` first.

### Tools (`frontend/src/editor/tools/`)

Extend `EditorTool`, or `ColorTool` when the tool paints a colour (it supplies the swatch, the
eyedropper, and separate colour memory for image and mask layers). Register in
`tools/index.ts`; that order is the toolbar order.

Unlike the existing UI's editor, a tool owns no DOM. It **describes** its controls by returning
`ToolOption[]` from `getOptions()` and receives edits through `setOption(key, value)`; the option
bar renders them once for every tool. This is what makes the controls translated, themed and
keyboard-reachable without each tool arranging for that itself.

Lifecycle hooks: `setActive` / `setInactive`, `onLayerChanged(previous, newLayer)`,
`onDocumentReset`, `onBeforeHistoryUndo`, `draw`, and the pointer handlers.

- `isMaskOnly` hides the tool unless the active layer is a mask.
- `isTempTool` marks a sub-tool with no toolbar button (the eyedropper); override `optionsOwner`
  so the bar keeps showing the tool it is serving.
- Return `true` from `onGlobalPointerMove` / `onGlobalPointerUp` to request a repaint.
- Return `true` from `onRightPointerDown` to claim the right button, which otherwise pans.

### React (`frontend/src/components/editor/`)

`ImageEditor.tsx` mounts the engine (`engine.attach(host)` returns the disposer), renders the
chrome, and supplies `EditorHost` - the services the engine cannot reach itself: backend feature
flags, the current generation input, a one-off generation runner, notices, and prompt appends.

`useEditorVersion()` re-renders on structural change. The engine calls `notify()` only for
discrete events (a layer, a tool, an option, the selection appearing or vanishing) - never from
the render loop or from pointer motion, or every brush dab would re-render React.

`LayerPanel.tsx` has two layouts and `ImageEditor.tsx` picks between them by width: a column down
the right edge, and a strip along the bottom for anything under `lg`. They are separate trees, not
one responsive one, because a row's thumbnail *is* that layer's canvas element and one element
cannot be in two lists at once. Anything added to one belongs in the other; the shared parts live
in `useLayerList`.

### Touch

- One finger is the tool. Two fingers are the view: pinch to zoom, drag to pan. The engine tracks
  every pointer that is down (`pointers`), and the second one switches the gesture over.
- Two fingers never land together, so the first has already had the tool do something by the time
  the second arrives. `beginGesture` closes that work properly and then rolls it back off the undo
  stack when the pair landed within `GESTURE_GRACE_MS` - a tool that acts on pointer-down needs no
  code of its own for this, but it does have to put its edit on the stack to be rolled back.
- `engine.coarsePointer` is set while the pointer in use is a fingertip. Use it to grow hit
  targets, not to change what anything does; `GeneralTool`'s handles carry a separate `hitRadius`
  for exactly this.

## Instructions

- Repaint with `engine.redraw()`, which coalesces onto an animation frame. Never paint directly.
- Call `engine.markChanged()` for any edit that changes what a generation would receive, and
  `engine.notify()` for anything React has to see.
- Take undo state with `layer.saveBeforeEdit()` (pixels + placement) or `layer.savePositions()`
  (placement only) *before* mutating, not after.
- Clip destructive edits to the selection with `applySelectionClip` / `getSelectionBoundsInLayer`
  / `getSelectionQuadInLayer` from the tool base. A rotated layer turns the selection into a
  parallelogram in its own space, so the bounds are only a fast reject.
- New user-facing strings go in `frontend/src/i18n/locales/en.json` **and every other locale
  file** - they are kept key-for-key in sync (see that directory's README).
- Icons come from `lucide-react`; this frontend ships no image assets.
- Anything the editor supplies at generation time belongs in `EDITOR_OWNED_PARAMS` (store.ts), so
  the parameter panel stops offering a second control for the same value.
