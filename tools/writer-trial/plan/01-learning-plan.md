# Learning plan

Build a local learning plan using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, or later tasks are needed.
A course may require other courses before it can be completed.

## Public API

Export exactly these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts PlanApp at the root element in index.html.

- Course is { id: string; title: string; done: boolean;
  prerequisiteIds: readonly string[] }.
- courses is Data.Cell<readonly Course[]>.
- createCourse is Operation.Handle<Course, { title: string }>.
- addPrerequisite is Operation.Handle<Course,
  { courseId: string; prerequisiteId: string }>.
- removePrerequisite has the same handle type as addPrerequisite.
- completeCourse is Operation.Handle<Course, { id: string }>.
- reopenCourse has the same handle type as completeCourse.
- undoPlan is Operation.Handle<void, void>.
- PlanApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with no courses.
Each PlanApp owns a fresh scope.
Two apps share no records, form text, selections, filter, or notice.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- BlankTitle: { title: unknown }.
- NotFound: { id: string }.
- SelfRequirement: { id: string }.
- Cycle: { courseId: string; prerequisiteId: string }.
- CourseDone: { id: string }.
- NotRequired: { courseId: string; prerequisiteId: string }.
- PrerequisitesOpen: { id: string; prerequisiteIds: readonly string[] }.
- DependentsDone: { id: string; dependentIds: readonly string[] }.
- EmptyUndo: {}.

Errors from the app are these managed kinds, not a wrapper error.
If several rules fail, any matching error is allowed.
An unknown course id reports NotFound with that id.
Both ids of a link must name saved courses.

## Create a course

Trim the title. Empty or non-text input reports BlankTitle.
BlankTitle keeps the original input value.
Duplicate titles are allowed; ids distinguish courses.
Create an incomplete course with no prerequisites.
Append it in creation order with a nonempty, scope-unique opaque id.
Return the saved course. Its title is the trimmed text.
Never reuse any id issued in that scope, including after undo.

## Link courses

A link means courseId requires prerequisiteId.
A course cannot require itself: report SelfRequirement with courseId.
Links must never form a cycle, even through several courses.
A cycle reports Cycle with the requested pair of ids.

Only an incomplete course may have its requirements changed.
Changing a completed course reports CourseDone with courseId.
The prerequisite course may itself be complete or incomplete.
A passing add appends the id to that course's prerequisiteIds.
Adding a link already present is a passing action with no change.
It adds no undo step and returns the saved course.

A passing remove removes only the named link.
An absent link reports NotRequired with the requested pair.
Keep all other prerequisite ids in their prior order.
Links never change titles, course ids, completion, or course list order.
Return the changed course after an add or remove.
All other saved courses remain unchanged.

For example, if Reading requires Basics and Practice requires Reading,
adding Practice as a requirement of Basics would form a cycle.
Reject that link and keep the whole plan unchanged.
This is a behavior example, not an implementation recipe.

## Complete and reopen

A course can be completed only when all its direct prerequisites are done.
Otherwise report PrerequisitesOpen with its id and all incomplete
prerequisite ids, in the order of its prerequisiteIds list.
A passing completion changes only that course's done field to true.
Completing an already completed course passes with no change or undo step.
Return the saved course.

A course can be reopened only when no completed course directly requires it.
Otherwise report DependentsDone with its id and those completed dependent
ids, in saved course list order.
A passing reopen changes only that course's done field to false.
Reopening an incomplete course passes with no change or undo step.
Return the saved course.

Every failed action leaves courses and undo history unchanged.
Do not partly update a record before finding a failed rule.

## Undo

Each passing create, changed link, or changed completion adds one undo step.
Passing actions that change no record add none.
Typing, choosing a filter, and choosing a course add none.
Failed actions add none.
undoPlan restores the exact course list before the last passing change.
Restore ids, titles, done values, link order, and course order.
Undo adds no new step. There is no redo.
Empty history reports EmptyUndo with {}.
Undo leaves typed form text, selections, and filters alone.
If a selection names a course removed by undo, later link actions
report NotFound for that selected id until the selection changes.

## Screen

The new-course form has a labeled text input Title and Add course.
Title starts empty. Success clears Title; failure keeps its text.

Show a table named Courses with Title, Status, and Requires columns.
Rows stay in saved course list order.
Status is Done when complete, Ready when incomplete with all prerequisites
done, and Blocked otherwise.
Requires shows the direct prerequisite titles in link order,
joined by comma and space; use None when there are no links.
Each incomplete row has a button named Complete <title>.
Each complete row has a button named Reopen <title>.
Keep these buttons enabled so blocked actions show the managed error.

The link form has labeled selects Course and Prerequisite.
Each lists every saved course in creation order, showing its title
and using its id as the option value. Start both selections empty.
An empty option has the text Choose course and value empty string.
The actions are Add requirement and Remove requirement.
Keep both selected ids after success, failure, and undo.
When a selected course is removed by undo, keep that selected id as
an option labeled Removed course, until the user chooses another option.
Selecting a course never changes a saved record.

All, Ready, and Done buttons filter only the course rows.
All starts selected. Ready shows incomplete courses with all requirements
done. Done shows only completed courses. Filtering never deletes records.
Changes to the plan update the shown rows and status without another click.

Undo is always available, including when history is empty.
Use one shared role=alert block showing the managed error kind.
An empty or absent alert is allowed when there is no error.
Every passing action clears an earlier error notice, including typing,
selecting, filtering, and a passing action that changes no record.

Test public operations and real browser behavior.
Run check, all tests, and build. Ask Jev about changed source and tests.
Report real commands and results, plus any issue still open.
