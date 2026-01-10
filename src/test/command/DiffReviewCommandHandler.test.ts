import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as gitUtil from "../../gitUtil";
import { DiffReviewCommandHandler } from "../../command/DiffReviewCommandHandler";
import type { PromptMetadataWithScope } from "../../review/types";

suite("DiffReviewCommandHandler Test Suite", function () {
  let handler: DiffReviewCommandHandler;
  let mockGetRepository: sinon.SinonStub;
  let mockGetDiffContent: sinon.SinonStub;
  let mockParseGitRange: sinon.SinonStub;
  let mockGetDefaultBaseBranch: sinon.SinonStub;
  let mockStream: vscode.ChatResponseStream;
  let mockToken: vscode.CancellationToken;

  setup(function () {
    handler = new DiffReviewCommandHandler();
    mockGetRepository = sinon.stub(gitUtil, "getRepository");
    mockGetDiffContent = sinon.stub(gitUtil, "getDiffContent");
    mockParseGitRange = sinon.stub(gitUtil, "parseGitRange");
    mockGetDefaultBaseBranch = sinon.stub(gitUtil, "getDefaultBaseBranch");

    mockStream = {
      markdown: sinon.stub(),
      progress: sinon.stub()
    } as unknown as vscode.ChatResponseStream;

    mockToken = {
      isCancellationRequested: false
    } as vscode.CancellationToken;

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

  suite("Error Handling", function () {
    test("should return error when no repository found", async function () {
      mockGetRepository.returns(undefined);

      const request = {
        prompt: "",
        model: { sendRequest: sinon.stub() } as any
      } as vscode.ChatRequest;

      const result = await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        []
      );

      assert.deepStrictEqual(result, {
        errorDetails: { message: "No Git repository found" }
      });

      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /Gitリポジトリが見つかりません/
      );
    });

    test("should return error when diff range extraction fails", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.throws(new Error("Invalid range"));

      const request = {
        prompt: "#range:invalid",
        model: { sendRequest: sinon.stub() } as any
      } as vscode.ChatRequest;

      const result = await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        []
      );

      assert.deepStrictEqual(result, {
        errorDetails: { message: "Failed to determine diff range" }
      });
    });

    test("should handle getDiffContent errors", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.rejects(new Error("Diff failed"));

      const request = {
        prompt: "",
        model: { sendRequest: sinon.stub() } as any
      } as vscode.ChatRequest;

      const result = await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        []
      );

      assert.ok(result?.errorDetails);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /差分取得エラー/
      );
    });

    test("should handle empty diff gracefully", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });
      mockGetDiffContent.resolves([]);

      const request = {
        prompt: "",
        model: { sendRequest: sinon.stub() } as any
      } as vscode.ChatRequest;

      const result = await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        []
      );

      assert.strictEqual(result, undefined);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /間に変更がありません/
      );
    });
  });

  suite("Range Parsing", function () {
    test("should extract range from #range: prompt", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "origin/develop", compare: "HEAD" });
      mockGetDiffContent.resolves([]);

      const request = {
        prompt: "#range:origin/develop...HEAD",
        model: { sendRequest: sinon.stub() } as any
      } as vscode.ChatRequest;

      await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        []
      );

      sinon.assert.calledWith(mockParseGitRange, "origin/develop...HEAD");
    });

    test("should use default range when no #range specified", async function () {
      const mockRepo = {
        rootUri: vscode.Uri.file("/workspace"),
        getBranch: sinon.stub().resolves({ name: "origin/main" })
      };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "origin/main", compare: "HEAD" });
      mockGetDefaultBaseBranch.resolves("origin/main");
      mockGetDiffContent.resolves([]);

      const request = {
        prompt: "",
        model: { sendRequest: sinon.stub() } as any
      } as vscode.ChatRequest;

      await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        []
      );

      // Should have called parseGitRange (with undefined as first arg for default)
      assert.ok(mockParseGitRange.called);
      // Verify it was called with undefined (no range specified in prompt)
      const firstCallArgs = mockParseGitRange.getCall(0).args;
      assert.strictEqual(firstCallArgs[0], undefined);
    });
  });

  suite("Review Pipeline", function () {
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

    test("should execute file review phase", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });

      const diffResults = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff content",
        changeType: "modified" as const,
        fileExtension: ".ts"
      }];
      mockGetDiffContent.resolves(diffResults);

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review prompt",
        scope: "file"
      }];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Review result";
        })()
      });

      const request = {
        prompt: "",
        model: { sendRequest: mockSendRequest } as any
      } as vscode.ChatRequest;

      await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        promptMetadata
      );

      // Should execute file review
      sinon.assert.called(mockSendRequest);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /ファイル単位レビュー/
      );
    });

    test("should execute changeset review phase", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });

      const diffResults = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff content",
        changeType: "modified" as const,
        fileExtension: ".ts"
      }];
      mockGetDiffContent.resolves(diffResults);

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/consistency.md",
        applyToPatterns: [],
        content: "Consistency check",
        scope: "changeset"
      }];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Consistency result";
        })()
      });

      const request = {
        prompt: "",
        model: { sendRequest: mockSendRequest } as any
      } as vscode.ChatRequest;

      await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        promptMetadata
      );

      sinon.assert.called(mockSendRequest);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /変更集合全体のレビュー/
      );
    });

    test("should handle cancellation during review", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });

      const diffResults = [
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
      ];
      mockGetDiffContent.resolves(diffResults);

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review prompt",
        scope: "file"
      }];

      // Simulate cancellation after first file
      let callCount = 0;
      const mockSendRequest = sinon.stub().callsFake(async () => {
        if (++callCount === 1) {
          mockToken.isCancellationRequested = true;
        }
        return {
          text: (async function* () {
            yield "Review result";
          })()
        };
      });

      const request = {
        prompt: "",
        model: { sendRequest: mockSendRequest } as any
      } as vscode.ChatRequest;

      await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        promptMetadata
      );

      // Should stop after cancellation
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /キャンセル/
      );
    });
  });

  suite("Multiple Files", function () {
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

    test("should process multiple files with different types", async function () {
      const mockRepo = { rootUri: vscode.Uri.file("/workspace") };
      mockGetRepository.returns(mockRepo);
      mockParseGitRange.returns({ base: "main", compare: "HEAD" });

      const diffResults = [
        {
          filePath: "/workspace/app.ts",
          relativePath: "app.ts",
          diff: "ts diff",
          changeType: "modified" as const,
          fileExtension: ".ts"
        },
        {
          filePath: "/workspace/script.py",
          relativePath: "script.py",
          diff: "py diff",
          changeType: "added" as const,
          fileExtension: ".py"
        },
        {
          filePath: "/workspace/schema.sql",
          relativePath: "schema.sql",
          diff: "sql diff",
          changeType: "modified" as const,
          fileExtension: ".sql"
        }
      ];
      mockGetDiffContent.resolves(diffResults);

      const promptMetadata: PromptMetadataWithScope[] = [
        {
          filePath: "/prompts/ts.md",
          applyToPatterns: ["**/*.ts"],
          content: "TS review",
          scope: "file"
        },
        {
          filePath: "/prompts/py.md",
          applyToPatterns: ["**/*.py"],
          content: "Python review",
          scope: "file"
        },
        {
          filePath: "/prompts/sql.md",
          applyToPatterns: ["**/*.sql"],
          content: "SQL review",
          scope: "file"
        }
      ];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Review result";
        })()
      });

      const request = {
        prompt: "",
        model: { sendRequest: mockSendRequest } as any
      } as vscode.ChatRequest;

      await handler.handle(
        request,
        {} as vscode.ChatContext,
        mockStream,
        mockToken,
        promptMetadata
      );

      // Should call sendRequest 3 times (once per file with matching prompt)
      assert.strictEqual(mockSendRequest.callCount, 3);

      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /3.*ファイル/
      );
    });
  });
});
