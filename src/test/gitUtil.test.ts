import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as gitUtil from "../gitUtil";

suite("gitUtil Test Suite", function () {

  suite("parseGitRange Tests", function () {
    test("should parse triple-dot range", function () {
      const result = gitUtil.parseGitRange("origin/main...HEAD");
      assert.deepStrictEqual(result, {
        base: "origin/main",
        compare: "HEAD"
      });
    });

    test("should parse double-dot range", function () {
      const result = gitUtil.parseGitRange("HEAD~3..HEAD");
      assert.deepStrictEqual(result, {
        base: "HEAD~3",
        compare: "HEAD"
      });
    });

    test("should use default when rangeSpec is undefined", function () {
      const result = gitUtil.parseGitRange(undefined, "origin/develop");
      assert.deepStrictEqual(result, {
        base: "origin/develop",
        compare: "HEAD"
      });
    });

    test("should use origin/main as default base when not specified", function () {
      const result = gitUtil.parseGitRange();
      assert.deepStrictEqual(result, {
        base: "origin/main",
        compare: "HEAD"
      });
    });

    test("should throw error for invalid range format", function () {
      assert.throws(
        () => gitUtil.parseGitRange("invalid-range"),
        /Invalid Git range format/
      );
    });

    test("should handle complex branch names", function () {
      const result = gitUtil.parseGitRange("feature/JIRA-123...origin/develop");
      assert.deepStrictEqual(result, {
        base: "feature/JIRA-123",
        compare: "origin/develop"
      });
    });
  });

  suite("parseDiffOutput Tests", function () {
    test("should parse simple added file", function () {
      const diffOutput = `diff --git a/file.ts b/file.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/file.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  console.log("Hello");
+}`;

      const result = gitUtil.parseDiffOutput(diffOutput, "/workspace");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].relativePath, "file.ts");
      assert.strictEqual(result[0].changeType, "added");
      assert.strictEqual(result[0].fileExtension, ".ts");
    });

    test("should parse modified file", function () {
      const diffOutput = `diff --git a/src/app.py b/src/app.py
index abc123..def456 100644
--- a/src/app.py
+++ b/src/app.py
@@ -1,5 +1,5 @@
-def old_function():
+def new_function():
     pass`;

      const result = gitUtil.parseDiffOutput(diffOutput, "/workspace");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].changeType, "modified");
      assert.strictEqual(result[0].relativePath, "src/app.py");
    });

    test("should parse deleted file", function () {
      const diffOutput = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index abc123..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-Line 1
-Line 2`;

      const result = gitUtil.parseDiffOutput(diffOutput, "/workspace");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].changeType, "deleted");
      assert.strictEqual(result[0].relativePath, "old.txt");
    });

    test("should parse renamed file", function () {
      const diffOutput = `diff --git a/old-name.js b/new-name.js
similarity index 100%
rename from old-name.js
rename to new-name.js`;

      const result = gitUtil.parseDiffOutput(diffOutput, "/workspace");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].changeType, "renamed");
      assert.strictEqual(result[0].relativePath, "new-name.js");
      assert.ok(result[0].oldPath?.endsWith("old-name.js"));
    });

    test("should skip binary files", function () {
      const diffOutput = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;

      const result = gitUtil.parseDiffOutput(diffOutput, "/workspace");

      assert.strictEqual(result.length, 0);
    });

    test("should parse multiple files", function () {
      const diffOutput = `diff --git a/file1.ts b/file1.ts
new file mode 100644
--- /dev/null
+++ b/file1.ts
@@ -0,0 +1 @@
+export const x = 1;
diff --git a/file2.py b/file2.py
index abc..def 100644
--- a/file2.py
+++ b/file2.py
@@ -1 +1 @@
-old
+new`;

      const result = gitUtil.parseDiffOutput(diffOutput, "/workspace");

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].relativePath, "file1.ts");
      assert.strictEqual(result[1].relativePath, "file2.py");
    });

    test("should handle empty diff", function () {
      const result = gitUtil.parseDiffOutput("", "/workspace");
      assert.strictEqual(result.length, 0);
    });

    test("should set correct file extensions", function () {
      const diffOutput = `diff --git a/test.sql b/test.sql
new file mode 100644
--- /dev/null
+++ b/test.sql
@@ -0,0 +1 @@
+SELECT * FROM users;`;

      const result = gitUtil.parseDiffOutput(diffOutput, "/workspace");

      assert.strictEqual(result[0].fileExtension, ".sql");
    });
  });

  suite("getGitExtension Tests", function () {
    let mockGetExtension: sinon.SinonStub;

    setup(function () {
      mockGetExtension = sinon.stub(vscode.extensions, "getExtension");
    });

    teardown(function () {
      mockGetExtension.restore();
    });

    test("should return extension when available", function () {
      const mockExtension = {
        exports: { getAPI: sinon.stub() },
        isActive: true
      };
      mockGetExtension.returns(mockExtension as any);

      const result = gitUtil.getGitExtension();

      assert.strictEqual(result, mockExtension.exports);
    });

    test("should return undefined when extension not found", function () {
      mockGetExtension.returns(undefined);

      const result = gitUtil.getGitExtension();

      assert.strictEqual(result, undefined);
    });
  });

  suite("getRepository Tests", function () {
    let mockGetExtension: sinon.SinonStub;
    let mockWorkspaceFolders: any;

    setup(function () {
      mockGetExtension = sinon.stub(vscode.extensions, "getExtension");
    });

    teardown(function () {
      mockGetExtension.restore();
      if (mockWorkspaceFolders && mockWorkspaceFolders.restore) {
        mockWorkspaceFolders.restore();
      }
    });

    test("should return repository for workspace", function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      const mockGitAPI = {
        getRepository: sinon.stub().returns(mockRepo),
        repositories: []
      };
      const mockExtension = {
        exports: { getAPI: sinon.stub().returns(mockGitAPI) },
        isActive: true
      };

      mockGetExtension.returns(mockExtension as any);
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);

      const result = gitUtil.getRepository();

      assert.strictEqual(result, mockRepo);
    });

    test("should return undefined when no workspace", function () {
      const mockExtension = {
        exports: { getAPI: sinon.stub().returns({ repositories: [] }) },
        isActive: true
      };

      mockGetExtension.returns(mockExtension as any);
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => undefined);

      const result = gitUtil.getRepository();

      assert.strictEqual(result, undefined);
    });

    test("should fallback to first repository when getRepository returns null", function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      const mockGitAPI = {
        getRepository: sinon.stub().returns(null),
        repositories: [mockRepo]
      };
      const mockExtension = {
        exports: { getAPI: sinon.stub().returns(mockGitAPI) },
        isActive: true
      };

      mockGetExtension.returns(mockExtension as any);
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);

      const result = gitUtil.getRepository();

      assert.strictEqual(result, mockRepo);
    });
  });

  suite("getDiffContent Tests", function () {
    test("should get diff between refs", async function () {
      const mockRepo = {
        rootUri: vscode.Uri.file("/workspace"),
        diffBetween: sinon.stub().resolves("diff --git a/file.ts b/file.ts\nnew file mode 100644")
      };

      const range: gitUtil.GitRange = {
        base: "origin/main",
        compare: "HEAD"
      };

      const result = await gitUtil.getDiffContent(mockRepo as any, range);

      assert.strictEqual(result.length, 1);
      sinon.assert.calledWith(mockRepo.diffBetween, "origin/main", "HEAD");
    });

    test("should return empty array for empty diff", async function () {
      const mockRepo = {
        rootUri: vscode.Uri.file("/workspace"),
        diffBetween: sinon.stub().resolves("")
      };

      const range: gitUtil.GitRange = { base: "main", compare: "HEAD" };

      const result = await gitUtil.getDiffContent(mockRepo as any, range);

      assert.strictEqual(result.length, 0);
    });

    test("should throw error when diffBetween fails", async function () {
      const mockRepo = {
        rootUri: vscode.Uri.file("/workspace"),
        diffBetween: sinon.stub().rejects(new Error("Invalid ref"))
      };

      const range: gitUtil.GitRange = { base: "invalid", compare: "HEAD" };

      await assert.rejects(
        () => gitUtil.getDiffContent(mockRepo as any, range),
        /Failed to get diff between/
      );
    });
  });

  suite("getDefaultBaseBranch Tests", function () {
    test("should return origin/main when available", async function () {
      const mockRepo = {
        getBranch: sinon.stub()
          .withArgs("origin/main").resolves({ name: "origin/main" })
      };

      const result = await gitUtil.getDefaultBaseBranch(mockRepo as any);

      assert.strictEqual(result, "origin/main");
    });

    test("should fallback to origin/master", async function () {
      const mockGetBranch = sinon.stub();
      mockGetBranch.withArgs("origin/main").resolves(undefined);
      mockGetBranch.withArgs("origin/master").resolves({ name: "origin/master" });

      const mockRepo = {
        getBranch: mockGetBranch
      };

      const result = await gitUtil.getDefaultBaseBranch(mockRepo as any);

      assert.strictEqual(result, "origin/master");
    });

    test("should default to origin/main when neither exists", async function () {
      const mockRepo = {
        getBranch: sinon.stub().resolves(undefined)
      };

      const result = await gitUtil.getDefaultBaseBranch(mockRepo as any);

      assert.strictEqual(result, "origin/main");
    });

    test("should handle getBranch errors gracefully", async function () {
      const mockRepo = {
        getBranch: sinon.stub().rejects(new Error("Git error"))
      };

      const result = await gitUtil.getDefaultBaseBranch(mockRepo as any);

      assert.strictEqual(result, "origin/main");
    });
  });
});
