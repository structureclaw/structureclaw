const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const { applyCriticalMissingAssertions, assertRoutingTrace, assertToolAuthorizers } = require("./assertions.js");

test("applyCriticalMissingAssertions enforces exact empty criticalMissing", () => {
  nodeAssert.doesNotThrow(() => {
    applyCriticalMissingAssertions([], { criticalMissing: [] });
  });

  nodeAssert.throws(() => {
    applyCriticalMissingAssertions(["floorLoads"], { criticalMissing: [] });
  }, /expected no criticalMissing/);
});

test("applyCriticalMissingAssertions supports criticalMissingIncludes", () => {
  nodeAssert.doesNotThrow(() => {
    applyCriticalMissingAssertions(["storyCount", "floorLoads"], {
      criticalMissingIncludes: ["storyCount"],
    });
  });

  nodeAssert.throws(() => {
    applyCriticalMissingAssertions(["floorLoads"], {
      criticalMissingIncludes: ["storyCount"],
    });
  }, /expected "storyCount" in criticalMissing/);
});

test("applyCriticalMissingAssertions supports criticalMissingNotIncludes", () => {
  nodeAssert.doesNotThrow(() => {
    applyCriticalMissingAssertions(["floorLoads"], {
      criticalMissingNotIncludes: ["storyCount", "bayCount"],
    });
  });

  nodeAssert.throws(() => {
    applyCriticalMissingAssertions(["storyCount", "floorLoads"], {
      criticalMissingNotIncludes: ["storyCount"],
    });
  }, /did not expect "storyCount" in criticalMissing/);
});

test("applyCriticalMissingAssertions can combine include and not-include rules", () => {
  nodeAssert.doesNotThrow(() => {
    applyCriticalMissingAssertions(["floorLoads"], {
      criticalMissingIncludes: ["floorLoads"],
      criticalMissingNotIncludes: ["storyCount", "bayCount"],
    });
  });
});

test("assertRoutingTrace checks selected, activated and resolved skills", () => {
  nodeAssert.doesNotThrow(() => {
    assertRoutingTrace({
      selectedSkillIds: ["frame", "opensees-static"],
      activatedSkillIds: ["frame", "opensees-static", "validation-structure-model"],
      structuralSkillId: "frame",
      analysisSkillId: "opensees-static"
    }, {
      selectedSkillIds: ["frame", "opensees-static"],
      activatedSkillIdsIncludes: ["validation-structure-model"],
      structuralSkillId: "frame",
      analysisSkillId: "opensees-static"
    });
  });
});

test("assertRoutingTrace treats selectedSkillIds as order-insensitive", () => {
  nodeAssert.doesNotThrow(() => {
    assertRoutingTrace({
      selectedSkillIds: ["frame", "opensees-static", "code-check-gb50017"],
      structuralSkillId: "frame",
      analysisSkillId: "opensees-static"
    }, {
      selectedSkillIds: ["code-check-gb50017", "frame", "opensees-static"],
      structuralSkillId: "frame",
      analysisSkillId: "opensees-static"
    });
  });
});

test("assertRoutingTrace throws when structuralSkillId mismatches", () => {
  nodeAssert.throws(() => {
    assertRoutingTrace({
      structuralSkillId: "generic"
    }, {
      structuralSkillId: "frame"
    });
  }, /expected structuralSkillId="frame", got "generic"/);
});

test("assertToolAuthorizers checks the skill ids attached to each tool call", () => {
  nodeAssert.doesNotThrow(() => {
    assertToolAuthorizers([
      { tool: "build_model", authorizedBySkillIds: ["frame"] },
      { tool: "run_analysis", authorizedBySkillIds: ["opensees-static"] }
    ], {
      build_model: ["frame"],
      run_analysis: ["opensees-static"]
    });
  });
});

test("assertToolAuthorizers throws when expected tool call is missing", () => {
  nodeAssert.throws(() => {
    assertToolAuthorizers([
      { tool: "build_model", authorizedBySkillIds: ["frame"] }
    ], {
      run_analysis: ["opensees-static"]
    });
  }, /expected tool call "run_analysis" to exist/);
});
