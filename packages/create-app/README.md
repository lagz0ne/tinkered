# @tinker/create-app

Make an app in this workspace:

```sh
vp create stack-app --no-interactive -- my-app
```

The command writes `apps/my-app` once.
The app owns its pages, schema, operations, and tests.
Its stack packages use `workspace:*`.

## Promises

- The bin writes an app that installs, builds, checks,
  and passes its tests.
- Writes app-owned files under apps with the given name.
- Refuses to overwrite an app's files.
- Refuses a name that is not one lowercase app directory.

## Checks

```sh
vp run create-app#test
vp run create-app#size
```
