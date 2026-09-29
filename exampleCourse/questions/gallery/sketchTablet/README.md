Ported from `sketch` by the experimental `pl-tablet-input/experimental/port_from_sketch.py`.
Randomization (`server.py`) is not carried over. Answer keys are generated from `pl-sketch-solution`, and can be redrawn in the freehand question builder.

| Canvas              | Result                      | Notes                                                                                                          |
| ------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `multi-curve`       | kept as `pl-sketch`         | has 3 drawing tools; freehand ink has one                                                                      |
| `sketch-sin`        | ported to `pl-tablet-input` | graded in function mode with a 15 px tolerance; ink outside the graded `x-range` now lowers the score          |
| `sketch-increasing` | kept as `pl-sketch`         | uses criteria with no freehand equivalent: greater-than, monot-increasing                                      |
| `sketch-concave`    | kept as `pl-sketch`         | uses criteria with no freehand equivalent: concave-up                                                          |
| `sketch-intersect`  | ported to `pl-tablet-input` | graded in overlap mode with a 15 px tolerance; `count` is approximated: extra or missing marks lower the score |
