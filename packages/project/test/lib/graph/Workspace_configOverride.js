/**
 * Unit tests for the 'config' override feature in UI5 Workspace
 * (specVersion workspace/2.0).
 *
 * Feature request: https://github.com/UI5/cli/issues/1369
 * "Option to specify custom UI5 config for workspace dependency resolution"
 *
 * With specVersion workspace/2.0, each resolution entry may now include an
 * optional 'config' property pointing to an alternative UI5 YAML config file.
 * This allows using different configurations for the same dependency in the
 * context of workspace resolution (e.g. to swap in a mock library).
 *
 * Covered scenarios:
 *  1. specVersion workspace/2.0 with 'config' — creates Module with custom configPath
 *  2. specVersion workspace/1.0 with 'config' — throws an error
 *  3. specVersion workspace/2.0 without 'config' — works normally (default ui5.yaml)
 *  4. Valid specVersion workspace/2.0 accepted by schema
 *  5. configPath resolves relative to module nodePath
 *  6. configPath absolute path passthrough
 *  7. _isConfigOverrideSupported helper
 *  8. npm workspace with configOverridePath → config NOT propagated to sub-packages
 */

import path from "node:path";
import test from "ava";
import sinonGlobal from "sinon";
import esmock from "esmock";
import Module from "../../../lib/graph/Module.js";

const __dirname = import.meta.dirname;
const libraryD = path.join(__dirname, "..", "..", "fixtures", "library.d");
const libraryE = path.join(__dirname, "..", "..", "fixtures", "library.e");

function createWorkspaceConfig(specVersion, dependencyManagement) {
	return {
		specVersion,
		metadata: {
			name: "workspace-name"
		},
		dependencyManagement
	};
}

test.beforeEach(async (t) => {
	const sinon = t.context.sinon = sinonGlobal.createSandbox();

	t.context.log = {
		warn: sinon.stub(),
		verbose: sinon.stub(),
		error: sinon.stub(),
		info: sinon.stub(),
		isLevelEnabled: () => true
	};

	t.context.Workspace = await esmock("../../../lib/graph/Workspace.js", {
		"@ui5/logger": {
			getLogger: sinon.stub().withArgs("graph:Workspace").returns(t.context.log)
		}
	});
});

test.afterEach.always((t) => {
	t.context.sinon.restore();
	esmock.purge(t.context.Workspace);
});

// ---------------------------------------------------------------------------
// 1. workspace/2.0 with 'config' → Module gets custom configPath
// ---------------------------------------------------------------------------

test("workspace/2.0: resolution with 'config' property creates Module with custom configPath", async (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/2.0", {
			resolutions: [{
				path: "../../fixtures/library.d",
				config: "ui5-mock.yaml"
			}]
		})
	});

	const {projectNameMap} = await workspace._getResolvedModules();

	t.truthy(projectNameMap.get("library.d"), "library.d must be in the projectNameMap");
	const mod = projectNameMap.get("library.d");
	t.true(mod instanceof Module, "must be a Module instance");

	// The module should use the custom configPath (resolved to absolute path)
	const expectedConfigPath = path.join(libraryD, "ui5-mock.yaml");
	t.is(mod._configPath, expectedConfigPath,
		"Module configPath must be the custom config resolved relative to the module directory");
	t.is(mod.getPath(), libraryD, "Module path should still be library.d");
});

// ---------------------------------------------------------------------------
// 2. workspace/1.0 with 'config' → throws an error
// ---------------------------------------------------------------------------

test("workspace/1.0: resolution with 'config' property throws an error", async (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/1.0", {
			resolutions: [{
				path: "../../fixtures/library.d",
				config: "ui5-mock.yaml"
			}]
		})
	});

	const err = await t.throwsAsync(workspace._getResolvedModules());
	t.true(
		err.message.includes("workspace/2.0"),
		"Error message must mention the required specVersion workspace/2.0"
	);
	t.true(
		err.message.includes("workspace/1.0"),
		"Error message must mention the current specVersion workspace/1.0"
	);
	t.true(
		err.message.includes("workspace-name"),
		"Error message must mention the workspace name"
	);
});

// ---------------------------------------------------------------------------
// 3. workspace/2.0 without 'config' → works normally (no configPath override)
// ---------------------------------------------------------------------------

test("workspace/2.0: resolution without 'config' property creates Module with default configPath", async (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/2.0", {
			resolutions: [{
				path: "../../fixtures/library.d"
			}]
		})
	});

	const {projectNameMap} = await workspace._getResolvedModules();

	t.truthy(projectNameMap.get("library.d"), "library.d must be in the projectNameMap");
	const mod = projectNameMap.get("library.d");
	// When no config is specified, Module falls back to "ui5.yaml" as default
	t.is(mod._configPath, "ui5.yaml",
		"Module should use the default configPath 'ui5.yaml' when no config override is given");
});

// ---------------------------------------------------------------------------
// 4. Schema validation: workspace/2.0 is a valid specVersion
// ---------------------------------------------------------------------------

test("Schema: workspace/2.0 is accepted as a valid specVersion", async (t) => {
	// If the Workspace constructor doesn't throw, the schema accepted workspace/2.0
	t.notThrows(() => {
		new t.context.Workspace({
			cwd: __dirname,
			configuration: createWorkspaceConfig("workspace/2.0", {
				resolutions: [{
					path: "../../fixtures/library.d",
					config: "ui5-mock.yaml"
				}]
			})
		});
	});
});

// ---------------------------------------------------------------------------
// 5. Config path is resolved relative to the module directory (not cwd)
// ---------------------------------------------------------------------------

test("workspace/2.0: configPath is resolved relative to the module directory, not cwd", async (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/2.0", {
			resolutions: [{
				path: "../../fixtures/library.d",
				config: "ui5-mock.yaml"
			}]
		})
	});

	const {projectNameMap} = await workspace._getResolvedModules();
	const mod = projectNameMap.get("library.d");

	// The configPath must be relative to the module (library.d), not to __dirname (test dir)
	const expectedConfigPath = path.join(libraryD, "ui5-mock.yaml");
	t.is(mod._configPath, expectedConfigPath);
	// Make sure it's not relative to __dirname
	t.not(mod._configPath, path.join(__dirname, "ui5-mock.yaml"));
});

// ---------------------------------------------------------------------------
// 6. Absolute configOverridePath is passed through unchanged
// ---------------------------------------------------------------------------

test("workspace/2.0: absolute configPath is passed through to Module unchanged", async (t) => {
	const absoluteConfigPath = path.join(libraryD, "ui5-mock.yaml");
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/2.0", {
			resolutions: [{
				path: "../../fixtures/library.d",
				config: absoluteConfigPath
			}]
		})
	});

	const {projectNameMap} = await workspace._getResolvedModules();
	const mod = projectNameMap.get("library.d");

	t.is(mod._configPath, absoluteConfigPath,
		"When an absolute path is given for config, it must be used as-is");
});

// ---------------------------------------------------------------------------
// 7. _isConfigOverrideSupported helper
// ---------------------------------------------------------------------------

test("_isConfigOverrideSupported: returns true for workspace/2.0", (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/2.0", {resolutions: []})
	});
	t.true(workspace._isConfigOverrideSupported("workspace/2.0"));
});

test("_isConfigOverrideSupported: returns false for workspace/1.0", (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/1.0", {resolutions: []})
	});
	t.false(workspace._isConfigOverrideSupported("workspace/1.0"));
});

test("_isConfigOverrideSupported: returns false for null/undefined/empty", (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/1.0", {resolutions: []})
	});
	t.false(workspace._isConfigOverrideSupported(null));
	t.false(workspace._isConfigOverrideSupported(undefined));
	t.false(workspace._isConfigOverrideSupported(""));
	t.false(workspace._isConfigOverrideSupported("invalid"));
});

test("_isConfigOverrideSupported: returns false for workspace/1.5", (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/1.0", {resolutions: []})
	});
	t.false(workspace._isConfigOverrideSupported("workspace/1.5"));
});

// ---------------------------------------------------------------------------
// 8. workspace/2.0 with 'config' + multiple resolutions — only the one with
//    config gets the custom configPath
// ---------------------------------------------------------------------------

test("workspace/2.0: only the resolution entry with 'config' uses custom configPath", async (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/2.0", {
			resolutions: [
				{
					path: "../../fixtures/library.d",
					config: "ui5-mock.yaml"
				},
				{
					path: "../../fixtures/library.e"
					// no config override
				}
			]
		})
	});

	const {projectNameMap} = await workspace._getResolvedModules();

	const libD = projectNameMap.get("library.d");
	t.truthy(libD, "library.d must be resolved");
	t.is(libD._configPath, path.join(libraryD, "ui5-mock.yaml"),
		"library.d must use the custom config");

	const libE = projectNameMap.get("library.e");
	t.truthy(libE, "library.e must be resolved");
	t.is(libE._configPath, "ui5.yaml",
		"library.e must use the default config");
});

// ---------------------------------------------------------------------------
// 9. Verbose log message is emitted when a config override is used
// ---------------------------------------------------------------------------

test("workspace/2.0: verbose log is emitted when config override is used", async (t) => {
	const workspace = new t.context.Workspace({
		cwd: __dirname,
		configuration: createWorkspaceConfig("workspace/2.0", {
			resolutions: [{
				path: "../../fixtures/library.d",
				config: "ui5-mock.yaml"
			}]
		})
	});

	await workspace._getResolvedModules();

	const verboseCalls = t.context.log.verbose.args;
	const hasConfigLog = verboseCalls.some(([msg]) =>
		msg && msg.includes("ui5-mock.yaml"));
	t.true(hasConfigLog, "A verbose log mentioning the custom config file must be emitted");
});
