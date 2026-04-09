const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const { applyCriticalMissingAssertions } = require("./assertions.js");

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
