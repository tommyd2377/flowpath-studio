# Legacy catalog cards: mobile reading and live reduced motion

The portable `CatalogExplorer` used by `/lab` retained a two-column featured-card interior on narrow screens. At 320px, the attribute column took the available width and the summary collapsed to zero. Its featured card now uses one column when the explorer container is at most 600px wide. The title, summary, attributes and comparison action keep their order; wide layouts keep the existing two-column composition. Embedded narrow explorers receive the same fix.

Cards and shortlist chips now subscribe to the shared live reduced-motion preference. Enabling reduction during an active interaction clears movement without remounting the control or losing keyboard focus. Explicit neutral targets and transforms prevent a held hover from retaining its old offset. Normal movement can resume on the next interaction when reduction is disabled. The motion policy override is scoped to the controlled card/chip; descendants retain the automatic user policy.

Verification uses the synthetic, local `/lab` catalog. Focused browser regressions cover 320/390px phone and embedded widths, keyboard opening and return, complete retained card text, toggling reduced motion from both initial preferences, intermediate normal hover frames, neutral reduced frames, and shortlist keyboard actions. These are renderer regressions, not evidence of live assistant, voice, ingestion or automatically generated website quality.

The active visitor comparison, current InformationGrid, website templates, published data and provider behavior are outside this change. Integration and final visitor-flow acceptance remain with the coordinating task.
