import * as assert from "assert";
import path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as gitUtil from "../../gitUtil";
import * as chatHandlerModule from "../../chatHandler";

/**
 * LanguageModelChatMessageのcontentからテキストを抽出
 * contentは配列形式で[{$mid: number, value: string}]の構造を持つ
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && content.length > 0 && content[0].value) {
    return content[0].value;
  }
  return JSON.stringify(content);
}

/**
 * E2E用のChatリクエストを作成する関数
 */
function createE2EChatRequest(
  command: string,
  prompt: string,
  sendRequestStub: sinon.SinonStub
): vscode.ChatRequest {
  return {
    command,
    prompt,
    references: [],
    toolReferences: [],
    toolInvocationToken: {} as never,
    model: {
      sendRequest: sendRequestStub,
    } as unknown as vscode.LanguageModelChat,
  };
}

/**
 * チャットレスポンスストリームのモックを作成
 */
function createMockStream() {
  return {
    markdown: sinon.stub(),
    progress: sinon.stub(),
  } as unknown as vscode.ChatResponseStream;
}

suite("codereviewDiff E2E統合テスト", function () {
  let mockGetConfiguration: sinon.SinonStub;
  let mockGetRepository: sinon.SinonStub;
  let mockGetDiffContent: sinon.SinonStub;
  let mockParseGitRange: sinon.SinonStub;
  let mockGetDefaultBaseBranch: sinon.SinonStub;
  let sendRequestStub: sinon.SinonStub;

  // テストフィクスチャは src/ にあるため、絶対パスで指定
  const fixturesDir = path.join(__dirname, "../../../src/test/__tests__/diff_review_fixtures");
  const promptsDir = path.join(fixturesDir, "prompts");

  const mockConfigReturns = {
    get: sinon.stub().callsFake((section: string) => {
      switch (section) {
        case "codeReview.diffPath":
          return promptsDir;
        case "prompt.excludeFilePatterns":
          return [];
        case "promptis.output.mode":
          return "chat-only"; // デフォルトはchat-only
        case "chat.outputPath":
          return undefined;
        case "telemetry.enableTelemetry":
          return false;
        default:
          return undefined;
      }
    }),
    has: sinon.stub().returns(true),
    inspect: sinon.stub().returns(undefined),
    update: sinon.stub().returns(Promise.resolve()),
  };

  setup(function () {
    mockGetConfiguration = sinon.stub(vscode.workspace, "getConfiguration").returns(mockConfigReturns);
    mockGetRepository = sinon.stub(gitUtil, "getRepository");
    mockGetDiffContent = sinon.stub(gitUtil, "getDiffContent");
    mockParseGitRange = sinon.stub(gitUtil, "parseGitRange");
    mockGetDefaultBaseBranch = sinon.stub(gitUtil, "getDefaultBaseBranch");

    sendRequestStub = sinon.stub().resolves({
      text: (async function* () {
        yield "Mocked review response";
      })()
    });

    // Setup default Git mocks
    const mockRepo = {
      rootUri: vscode.Uri.file("/workspace"),
      diffBetween: sinon.stub()
    };
    mockGetRepository.returns(mockRepo);
    mockGetDefaultBaseBranch.resolves("origin/main");
  });

  teardown(function () {
    sinon.restore();
  });

  suite("デフォルト範囲シナリオ", function () {
    test("should use origin/main...HEAD by default", async function () {
      mockParseGitRange.returns({ base: "origin/main", compare: "HEAD" });
      mockGetDiffContent.resolves([{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff content",
        changeType: "modified" as const,
        fileExtension: ".ts"
      }]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWith(mockParseGitRange, undefined, "origin/main");
      sinon.assert.calledWith(mockGetDiffContent, sinon.match.any, {
        base: "origin/main",
        compare: "HEAD"
      });
    });
  });

  suite("カスタム範囲シナリオ", function () {
    test("should parse #range:origin/main...HEAD", async function () {
      mockParseGitRange.returns({ base: "origin/main", compare: "HEAD" });
      mockGetDiffContent.resolves([]);

      const request = createE2EChatRequest("codereviewDiff", "#range:origin/main...HEAD", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWith(mockParseGitRange, "origin/main...HEAD");
    });

    test("should parse #range:HEAD~3..HEAD", async function () {
      mockParseGitRange.returns({ base: "HEAD~3", compare: "HEAD" });
      mockGetDiffContent.resolves([]);

      const request = createE2EChatRequest("codereviewDiff", "#range:HEAD~3..HEAD", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWith(mockParseGitRange, "HEAD~3..HEAD");
    });

    test("should parse #range:origin/develop...HEAD", async function () {
      mockParseGitRange.returns({ base: "origin/develop", compare: "HEAD" });
      mockGetDiffContent.resolves([]);

      const request = createE2EChatRequest("codereviewDiff", "#range:origin/develop...HEAD", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWith(mockParseGitRange, "origin/develop...HEAD");
    });
  });

  suite("エラーシナリオ", function () {
    test("should handle no Git repository error", async function () {
      mockGetRepository.returns(undefined);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      const result = await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      assert.deepStrictEqual(result, {
        errorDetails: { message: "No Git repository found" }
      });

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /Gitリポジトリが見つかりません/
      );
    });

    test("should handle invalid range error", async function () {
      mockParseGitRange.throws(new Error("Invalid Git range format"));

      const request = createE2EChatRequest("codereviewDiff", "#range:invalid-format", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      const result = await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      assert.ok(result?.errorDetails);
      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /差分範囲を特定できません/
      );
    });

    test("should handle empty diff (no changes)", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /間に変更がありません/
      );
    });
  });

  suite("複数ファイルシナリオ", function () {
    let mockWorkspaceFolders: any;

    setup(function () {
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);
    });

    teardown(function () {
      if (mockWorkspaceFolders && mockWorkspaceFolders.restore) {
        mockWorkspaceFolders.restore();
      }
    });

    test("should process multiple files with different extensions", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([
        {
          filePath: "/workspace/app.ts",
          relativePath: "src/app.ts",
          diff: "ts diff",
          changeType: "modified" as const,
          fileExtension: ".ts"
        },
        {
          filePath: "/workspace/schema.sql",
          relativePath: "db/schema.sql",
          diff: "sql diff",
          changeType: "added" as const,
          fileExtension: ".sql"
        },
        {
          filePath: "/workspace/infra.tf",
          relativePath: "terraform/infra.tf",
          diff: "tf diff",
          changeType: "modified" as const,
          fileExtension: ".tf"
        }
      ]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Should call LLM for each file with matching prompts
      // TS file: typescript-review.md
      // SQL file: sql-review.md
      // TF file: terraform-review.md
      // Plus changeset prompts: api-consistency.md, schema-consistency.md
      // Total: 3 file reviews + 2 changeset reviews = 5
      assert.strictEqual(sendRequestStub.callCount, 5);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /3.*ファイル/
      );
    });
  });

  suite("変更タイプシナリオ", function () {
    let mockWorkspaceFolders: any;

    setup(function () {
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);
    });

    teardown(function () {
      if (mockWorkspaceFolders && mockWorkspaceFolders.restore) {
        mockWorkspaceFolders.restore();
      }
    });

    test("should process added file", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([{
        filePath: "/workspace/new.ts",
        relativePath: "src/new.ts",
        diff: "new file diff",
        changeType: "added" as const,
        fileExtension: ".ts"
      }]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /added/
      );
    });

    test("should process deleted file", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([{
        filePath: "/workspace/old.ts",
        relativePath: "src/old.ts",
        diff: "deleted file diff",
        changeType: "deleted" as const,
        fileExtension: ".ts"
      }]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /deleted/
      );
    });

    test("should process renamed file", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([{
        filePath: "/workspace/new-name.ts",
        relativePath: "src/new-name.ts",
        diff: "rename diff",
        changeType: "renamed" as const,
        oldPath: "/workspace/old-name.ts",
        fileExtension: ".ts"
      }]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /renamed/
      );
    });

    test("should process modified file", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([{
        filePath: "/workspace/app.ts",
        relativePath: "src/app.ts",
        diff: "modified diff",
        changeType: "modified" as const,
        fileExtension: ".ts"
      }]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /modified/
      );
    });
  });

  suite("プロンプトフィルタリングシナリオ", function () {
    let mockWorkspaceFolders: any;

    setup(function () {
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);
    });

    teardown(function () {
      if (mockWorkspaceFolders && mockWorkspaceFolders.restore) {
        mockWorkspaceFolders.restore();
      }
    });

    test("should apply only prompts matching applyTo patterns", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([
        {
          filePath: "/workspace/app.py",
          relativePath: "app.py",
          diff: "python diff",
          changeType: "modified" as const,
          fileExtension: ".py"
        }
      ]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Should use python-review.md (file) + changeset prompts
      // NOT typescript-review.md, sql-review.md, or terraform-review.md
      const calls = sendRequestStub.getCalls();
      const promptContents = calls.map(call => {
        const messages = call.args[0];
        const content = extractTextContent(messages[0].content);
        return content;
      });

      const hasPythonPrompt = promptContents.some((content: string) =>
        content.includes("Python") || content.includes("python")
      );
      const hasTypescriptPrompt = promptContents.some((content: string) =>
        content.includes("TypeScript")
      );

      assert.ok(hasPythonPrompt, "Python prompt was applied");
      assert.ok(!hasTypescriptPrompt, "TypeScript prompt was NOT applied");
    });

    test("should skip files with no matching prompts", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([
        {
          filePath: "/workspace/data.json",
          relativePath: "data.json",
          diff: "json diff",
          changeType: "modified" as const,
          fileExtension: ".json"
        }
      ]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Should only execute changeset prompts (no file-level prompts match .json)
      // api-consistency.md + schema-consistency.md = 2 calls
      assert.strictEqual(sendRequestStub.callCount, 2);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /マッチするプロンプトがありません/
      );
    });
  });

  suite("出力モードシナリオ", function () {
    let mockWorkspaceFolders: any;

    setup(function () {
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);
    });

    teardown(function () {
      if (mockWorkspaceFolders && mockWorkspaceFolders.restore) {
        mockWorkspaceFolders.restore();
      }
    });

    test("should work in file-only mode", async function () {
      // Change output mode to file-only
      mockConfigReturns.get.withArgs("promptis.output.mode").returns("file-only");
      mockConfigReturns.get.withArgs("chat.outputPath").returns(path.join(__dirname, "../../out/"));

      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff",
        changeType: "modified" as const,
        fileExtension: ".ts"
      }]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Should still execute reviews
      assert.ok(sendRequestStub.called);
    });
  });

  suite("キャンセルシナリオ", function () {
    let mockWorkspaceFolders: any;

    setup(function () {
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);
    });

    teardown(function () {
      if (mockWorkspaceFolders && mockWorkspaceFolders.restore) {
        mockWorkspaceFolders.restore();
      }
    });

    test("should handle cancellation gracefully", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([
        {
          filePath: "/workspace/file1.ts",
          relativePath: "file1.ts",
          diff: "diff1",
          changeType: "modified" as const,
          fileExtension: ".ts"
        },
        {
          filePath: "/workspace/file2.ts",
          relativePath: "file2.ts",
          diff: "diff2",
          changeType: "modified" as const,
          fileExtension: ".ts"
        }
      ]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();

      let callCount = 0;
      const token = {
        get isCancellationRequested() {
          return ++callCount > 1;
        }
      } as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      sinon.assert.calledWithMatch(
        stream.markdown as sinon.SinonSpy,
        /キャンセル/
      );
    });
  });

  suite("二段パイプライン", function () {
    let mockWorkspaceFolders: any;

    setup(function () {
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
      mockWorkspaceFolders.get(() => [{ uri: vscode.Uri.file("/workspace") }]);
    });

    teardown(function () {
      if (mockWorkspaceFolders && mockWorkspaceFolders.restore) {
        mockWorkspaceFolders.restore();
      }
    });

    test("should execute file review phase first", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff",
        changeType: "modified" as const,
        fileExtension: ".ts"
      }]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      const markdownCalls = (stream.markdown as sinon.SinonSpy).getCalls();
      const messages = markdownCalls.map(c => c.args[0]).join("");

      // Verify file review section appears before changeset review
      const fileReviewIndex = messages.indexOf("ファイル単位レビュー");
      const changesetReviewIndex = messages.indexOf("変更集合全体のレビュー");

      assert.ok(fileReviewIndex > -1, "File review section exists");
      assert.ok(changesetReviewIndex > -1, "Changeset review section exists");
      assert.ok(fileReviewIndex < changesetReviewIndex, "File review comes before changeset review");
    });

    test("should execute changeset review phase second", async function () {
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([
        {
          filePath: "/workspace/api.ts",
          relativePath: "api.ts",
          diff: "api diff",
          changeType: "modified" as const,
          fileExtension: ".ts"
        },
        {
          filePath: "/workspace/schema.sql",
          relativePath: "schema.sql",
          diff: "schema diff",
          changeType: "modified" as const,
          fileExtension: ".sql"
        }
      ]);

      const request = createE2EChatRequest("codereviewDiff", "", sendRequestStub);
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Changeset prompts should receive context with ALL files
      const changesetCalls = sendRequestStub.getCalls().filter(call => {
        const messages = call.args[0];
        const context = extractTextContent(messages[1]?.content);
        return context.includes("変更集合レビュー");
      });

      assert.ok(changesetCalls.length > 0, "Changeset prompts were executed");

      // Verify changeset context includes both files
      const context = extractTextContent(changesetCalls[0].args[0][1].content);
      assert.ok(context.includes("api.ts"), "Changeset includes api.ts");
      assert.ok(context.includes("schema.sql"), "Changeset includes schema.sql");
    });
  });
});
