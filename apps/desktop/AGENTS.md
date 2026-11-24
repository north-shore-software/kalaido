# AGENTS.md

These are the instructions for working on the app UI. Follow these instructions in combination with more general instructions for the entire project.

## Design system

Changes should adhere to the design system as described in `./DESIGN.md`.

## Change budget

UI feature changes should ideally be limited in scope to make them easier to review. Ideally the number of lines of code (LOC) changed will be between 100 and 300 per feature.

When you finish making changes, spawn a sub-agent to calculate the total number of LOC changed on the current branch. The sub-agent should report combined total by adding the number of lines added to the number of lines subtracted.

When you have this figure:

- If the number is less than 250 LOC, do nothing.
- If the number is 250 LOC or greater, report the number of LOC changed and advise the user that the feature is growing large. The user will decide what to do with this information on their own.
