import * as z from 'zod/v4';

import { booleanFormat, integerFormat, numberFormat } from '../helpers.js';
import type { ElementSchemaModule } from '../types.js';

const plTabletInputAttributesSchema = z
  .object({
    'allow-blank': booleanFormat().optional(),
    'answers-name': z.string(),
    'background-fit': z.enum(['contain', 'stretch']).optional(),
    'background-image': z.string().optional(),
    grading: z.enum(['overlap', 'function']).optional(),
    height: integerFormat().optional(),
    'max-points': integerFormat().optional(),
    'partial-credit': booleanFormat().optional(),
    'pass-threshold': numberFormat().optional(),
    'reference-file': z.string().optional(),
    'stroke-color': z.string().optional(),
    'stroke-width': numberFormat().optional(),
    telemetry: booleanFormat().optional(),
    tolerance: numberFormat().optional(),
    weight: integerFormat().optional(),
    width: integerFormat().optional(),
  })
  .strict();

export const element: ElementSchemaModule = {
  tag: 'pl-tablet-input',
  schema: z.toJSONSchema(plTabletInputAttributesSchema, { target: 'draft-04' }),
};
