import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ChangesetReviewPhase } from "../../review/ChangesetReviewPhase";
import type { DiffResult } from "../../gitUtil";
import type { FileReviewResult, PromptMetadataWithScope } from "../../review/types";

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

suite("ChangesetReviewPhase Test Suite", function () {
  let phase: ChangesetReviewPhase;
  let mockStream: vscode.ChatResponseStream;
  let mockToken: vscode.CancellationToken;

  setup(function () {
    phase = new ChangesetReviewPhase();
    mockStream = {
      markdown: sinon.stub()
    } as unknown as vscode.ChatResponseStream;
    mockToken = {
      isCancellationRequested: false
    } as vscode.CancellationToken;
  });

  teardown(function () {
    sinon.restore();
  });

  suite("Prompt Filtering", function () {
    test("should only process scope:changeset prompts", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [
        {
          filePath: "/prompts/file.md",
          applyToPatterns: ["*.ts"],
          content: "File prompt",
          scope: "file"
        },
        {
          filePath: "/prompts/changeset.md",
          applyToPatterns: [],
          content: "Changeset prompt",
          scope: "changeset"
        }
      ];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Consistency check";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Should only call for changeset prompt
      sinon.assert.calledOnce(mockSendRequest);
    });

    test("should warn when no changeset prompts found", async function () {
      const diffResults: DiffResult[] = [];
      const fileReviewResults: FileReviewResult[] = [];
      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/file.md",
        applyToPatterns: ["*.ts"],
        content: "File only",
        scope: "file"
      }];

      const model = {} as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /変更集合レビュー用プロンプトが見つかりません/
      );
    });
  });

  suite("Context Construction", function () {
    test("should build context with file list and diffs", async function () {
      const diffResults: DiffResult[] = [
        {
          filePath: "/workspace/api.ts",
          relativePath: "src/api.ts",
          diff: "api diff content",
          changeType: "modified",
          fileExtension: ".ts"
        },
        {
          filePath: "/workspace/schema.sql",
          relativePath: "db/schema.sql",
          diff: "schema diff content",
          changeType: "added",
          fileExtension: ".sql"
        }
      ];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/consistency.md",
        applyToPatterns: [],
        content: "Check consistency",
        scope: "changeset"
      }];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Consistency OK";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Verify context structure
      const callArgs = mockSendRequest.getCall(0).args[0];
      assert.strictEqual(callArgs.length, 2);

      const contextMessage = extractTextContent(callArgs[1].content);

      // Should contain file list
      assert.ok(contextMessage.includes("変更ファイル一覧"));
      assert.ok(contextMessage.includes("src/api.ts"));
      assert.ok(contextMessage.includes("db/schema.sql"));

      // Should contain diffs
      assert.ok(contextMessage.includes("各ファイルの差分"));
      assert.ok(contextMessage.includes("api diff content"));
      assert.ok(contextMessage.includes("schema diff content"));

      // Should include change types
      assert.ok(contextMessage.includes("modified"));
      assert.ok(contextMessage.includes("added"));
    });

    test("should include file extensions in context", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/app.py",
        relativePath: "app.py",
        diff: "python diff",
        changeType: "modified",
        fileExtension: ".py"
      }];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/changeset.md",
        applyToPatterns: [],
        content: "Review",
        scope: "changeset"
      }];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "OK";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      const contextMessage = extractTextContent(mockSendRequest.getCall(0).args[0][1].content);
      assert.ok(contextMessage.includes(".py"));
    });
  });

  suite("Multiple Prompts", function () {
    test("should execute all changeset prompts", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [
        {
          filePath: "/prompts/api-consistency.md",
          applyToPatterns: [],
          content: "API consistency check",
          scope: "changeset"
        },
        {
          filePath: "/prompts/schema-consistency.md",
          applyToPatterns: [],
          content: "Schema consistency check",
          scope: "changeset"
        },
        {
          filePath: "/prompts/security.md",
          applyToPatterns: [],
          content: "Security check",
          scope: "changeset"
        }
      ];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Check passed";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Should call for each changeset prompt
      assert.strictEqual(mockSendRequest.callCount, 3);
    });
  });

  suite("LLM Interaction", function () {
    test("should send prompt and context to LLM", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff content",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/consistency.md",
        applyToPatterns: [],
        content: "Check API consistency",
        scope: "changeset"
      }];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Looks good!";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      const callArgs = mockSendRequest.getCall(0).args[0];

      // First message: prompt
      const promptMessage = extractTextContent(callArgs[0].content);
      assert.ok(promptMessage.includes("Check API consistency"));

      // Second message: context
      const contextMessage = extractTextContent(callArgs[1].content);
      assert.ok(contextMessage.includes("変更集合レビュー"));
    });

    test("should stream LLM response", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/consistency.md",
        applyToPatterns: [],
        content: "Review",
        scope: "changeset"
      }];

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Part 1\n";
          yield "Part 2\n";
          yield "Part 3\n";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      const markdownCalls = (mockStream.markdown as sinon.SinonSpy).getCalls();
      const streamed = markdownCalls.map(c => c.args[0]).join("");

      assert.ok(streamed.includes("Part 1"));
      assert.ok(streamed.includes("Part 2"));
      assert.ok(streamed.includes("Part 3"));
    });

    test("should handle LLM errors gracefully", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/consistency.md",
        applyToPatterns: [],
        content: "Review",
        scope: "changeset"
      }];

      const mockSendRequest = sinon.stub().rejects(new Error("Network error"));

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /レビューエラー/
      );
    });
  });

  suite("Cancellation Handling", function () {
    test("should stop processing when cancelled", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const fileReviewResults: FileReviewResult[] = [];

      const promptMetadata: PromptMetadataWithScope[] = [
        {
          filePath: "/prompts/consistency1.md",
          applyToPatterns: [],
          content: "Review 1",
          scope: "changeset"
        },
        {
          filePath: "/prompts/consistency2.md",
          applyToPatterns: [],
          content: "Review 2",
          scope: "changeset"
        }
      ];

      let callCount = 0;
      const mockSendRequest = sinon.stub().callsFake(async () => {
        if (++callCount === 1) {
          mockToken.isCancellationRequested = true;
        }
        return {
          text: (async function* () {
            yield "Review";
          })()
        };
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        fileReviewResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Should only process first prompt
      assert.strictEqual(mockSendRequest.callCount, 1);

      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /キャンセル/
      );
    });
  });
});
