/** Tool registry. Order here is the order of the toolbar. */

import type { ImageEditorEngine } from '../engine';
import type { EditorTool } from './base';
import { GeneralTool } from './general';
import { MoveTool } from './move';
import { SelectTool } from './select';
import { BrushTool } from './brush';
import { BucketTool } from './bucket';
import { ShapeTool } from './shape';
import { PickerTool } from './picker';
import { Sam2BBoxTool, Sam2PointsTool } from './sam2';

export function buildTools(engine: ImageEditorEngine): EditorTool[] {
    return [
        new GeneralTool(engine),
        new MoveTool(engine),
        new SelectTool(engine),
        new BrushTool(engine, false),
        new BrushTool(engine, true),
        new BucketTool(engine),
        new ShapeTool(engine),
        new PickerTool(engine),
        new Sam2PointsTool(engine),
        new Sam2BBoxTool(engine)
    ];
}
