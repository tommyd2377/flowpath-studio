# Assistant information layer

The global carousel implementation has been superseded by the [evolving information surface](../information-surface.md). That document is the current architecture, state-history, layout, motion, context, media and verification guide.

`VisitorWorkspace`, `VisitorCarousel.module.css`, `carouselCommand` and the `navigate_carousel` transport name remain for compatibility. They no longer imply whole-card slides, previous/next controls, conversation counters, swipe navigation, or mutually exclusive media/answer projections.

The assistant displays one persistent composition above the independent website. Back restores whole meaningful request states. Gallery and collection controls remain local to their component. Voice and chat use the same committed surface and published fact authority.
