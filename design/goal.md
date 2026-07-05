# Design Goal

Navigate the Daimio2 design space: carry the open design threads, and drive
the current focus to decisions.

## Current focus (2026-07-04): Black Hole

> Right now we're focusing on a new feature called a Black Hole. It's a
> subspace, similar to the "socket" subspace, but there's an external app
> that sits inside it. So it functions a bit like the Outerspace: ships that
> go through an "in" port on the black hole disappear from the Daimio
> runtime, just like ships that go into an "out" port from the Outerspace.
> And conversely ships can emerge from the black hole through its "out" port
> into the Daimio runtime, just like "in" ports from the Outerspace.

Constraint for today: get the Black Hole into D2-spec.md, then upgrade the
test suite. Interesting-but-not-blocking decisions get pinned (DEFER) rather
than resolved.

## Standing threads

Long-running design threads (split-1-daimio, runtime-isolation,
alias-attenuation, explore-topics) are carried in the gen file HEAD.
