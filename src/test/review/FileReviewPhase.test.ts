import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { FileReviewPhase } from "../../review/FileReviewPhase";
import type { DiffResult } from "../../gitUtil";
import type { PromptMetadataWithScope } from "../../review/types";
import * as util from "../../util";

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

suite("FileReviewPhase Test Suite", function () {
  let phase: FileReviewPhase;
  let mockStream: vscode.ChatResponseStream;
  let mockToken: vscode.CancellationToken;
  let mockFilterPromptsByTarget: sinon.SinonStub;

  setup(function () {
    phase = new FileReviewPhase();
    mockStream = {
      markdown: sinon.stub()
    } as unknown as vscode.ChatResponseStream;
    mockToken = {
      isCancellationRequested: false
    } as vscode.CancellationToken;

    mockFilterPromptsByTarget = sinon.stub(util, "filterPromptsByTarget");
  });

  teardown(function () {
    sinon.restore();
  });

  suite("Prompt Filtering", function () {
    test("should only process scope:file prompts", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff content",
        changeType: "modified",
        fileExtension: ".ts"
      }];

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

      mockFilterPromptsByTarget.returns([promptMetadata[0]]);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Review";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Should only use file-scoped prompts
      sinon.assert.calledOnce(mockFilterPromptsByTarget);
      sinon.assert.calledOnce(mockSendRequest);
    });

    test("should warn when no file prompts found", async function () {
      const diffResults: DiffResult[] = [];
      const promptMetadata: PromptMetadataWithScope[] = [
        {
          filePath: "/prompts/changeset.md",
          applyToPatterns: [],
          content: "Changeset only",
          scope: "changeset"
        }
      ];

      const model = {} as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      assert.strictEqual(results.length, 0);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /ファイル単位レビュー用プロンプトが見つかりません/
      );
    });

    test("should apply prompts based on applyTo patterns", async function () {
      const diffResults: DiffResult[] = [
        {
          filePath: "/workspace/app.ts",
          relativePath: "app.ts",
          diff: "ts diff",
          changeType: "modified",
          fileExtension: ".ts"
        },
        {
          filePath: "/workspace/script.py",
          relativePath: "script.py",
          diff: "py diff",
          changeType: "added",
          fileExtension: ".py"
        }
      ];

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
        }
      ];

      // First call returns TS prompt, second returns Python prompt
      mockFilterPromptsByTarget
        .onFirstCall().returns([promptMetadata[0]])
        .onSecondCall().returns([promptMetadata[1]]);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Review";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      assert.strictEqual(results.length, 2);
      assert.strictEqual(mockFilterPromptsByTarget.callCount, 2);
      assert.strictEqual(mockSendRequest.callCount, 2);
    });

    test("should skip files with no matching prompts", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/config.json",
        relativePath: "config.json",
        diff: "json diff",
        changeType: "modified",
        fileExtension: ".json"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/ts.md",
        applyToPatterns: ["**/*.ts"],
        content: "TS only",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns([]);

      const model = {} as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      assert.strictEqual(results.length, 0);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /マッチするプロンプトがありません/
      );
    });
  });

  suite("LLM Interaction", function () {
    test("should send diff content to LLM", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff --git a/file.ts b/file.ts\n+new code",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review this code",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Reviewed!";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Verify messages sent to LLM
      const callArgs = mockSendRequest.getCall(0).args[0];
      assert.strictEqual(callArgs.length, 2);

      // First message: prompt
      const promptMessage = extractTextContent(callArgs[0].content);
      assert.ok(promptMessage.includes("Review this code"));

      // Second message: diff
      const diffMessage = extractTextContent(callArgs[1].content);
      assert.ok(diffMessage.includes("diff --git"));
      assert.ok(diffMessage.includes("new code"));
    });

    test("should stream LLM response to output", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff content",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Line 1\n";
          yield "Line 2\n";
          yield "Line 3\n";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Check that all chunks were streamed
      const markdownCalls = (mockStream.markdown as sinon.SinonSpy).getCalls();
      const streamedContent = markdownCalls
        .map(call => call.args[0])
        .join("");

      assert.ok(streamedContent.includes("Line 1"));
      assert.ok(streamedContent.includes("Line 2"));
      assert.ok(streamedContent.includes("Line 3"));
    });

    test("should handle LLM errors gracefully", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/file.ts",
        relativePath: "file.ts",
        diff: "diff content",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

      const mockSendRequest = sinon.stub().rejects(new Error("LLM timeout"));

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Should still return a result with error message
      assert.strictEqual(results.length, 1);
      assert.ok(results[0].reviewText.includes("エラー"));

      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /レビューエラー/
      );
    });
  });

  suite("Cancellation Handling", function () {
    test("should stop processing when cancelled", async function () {
      const diffResults: DiffResult[] = [
        {
          filePath: "/workspace/file1.ts",
          relativePath: "file1.ts",
          diff: "diff1",
          changeType: "modified",
          fileExtension: ".ts"
        },
        {
          filePath: "/workspace/file2.ts",
          relativePath: "file2.ts",
          diff: "diff2",
          changeType: "modified",
          fileExtension: ".ts"
        }
      ];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

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

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      // Should only process first file
      assert.strictEqual(results.length, 1);
      assert.strictEqual(mockSendRequest.callCount, 1);

      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /キャンセル/
      );
    });
  });

  suite("Result Construction", function () {
    test("should return FileReviewResult with all fields", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/app.ts",
        relativePath: "src/app.ts",
        diff: "diff content here",
        changeType: "modified",
        fileExtension: ".ts"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["**/*.ts"],
        content: "Review prompt",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "This is the review text";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].filePath, "/workspace/app.ts");
      assert.strictEqual(results[0].relativePath, "src/app.ts");
      assert.strictEqual(results[0].fileExtension, ".ts");
      assert.strictEqual(results[0].diff, "diff content here");
      assert.ok(results[0].reviewText.includes("This is the review text"));
    });
  });

  suite("Change Types", function () {
    test("should process added files", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/new.ts",
        relativePath: "new.ts",
        diff: "new file diff",
        changeType: "added",
        fileExtension: ".ts"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Review";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      assert.strictEqual(results.length, 1);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /added/
      );
    });

    test("should process deleted files", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/old.ts",
        relativePath: "old.ts",
        diff: "deleted file diff",
        changeType: "deleted",
        fileExtension: ".ts"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Review";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      assert.strictEqual(results.length, 1);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /deleted/
      );
    });

    test("should process renamed files", async function () {
      const diffResults: DiffResult[] = [{
        filePath: "/workspace/new-name.ts",
        relativePath: "new-name.ts",
        diff: "rename diff",
        changeType: "renamed",
        oldPath: "/workspace/old-name.ts",
        fileExtension: ".ts"
      }];

      const promptMetadata: PromptMetadataWithScope[] = [{
        filePath: "/prompts/review.md",
        applyToPatterns: ["*.ts"],
        content: "Review",
        scope: "file"
      }];

      mockFilterPromptsByTarget.returns(promptMetadata);

      const mockSendRequest = sinon.stub().resolves({
        text: (async function* () {
          yield "Review";
        })()
      });

      const model = { sendRequest: mockSendRequest } as unknown as vscode.LanguageModelChat;

      const results = await phase.execute(
        diffResults,
        promptMetadata,
        model,
        mockToken,
        mockStream,
        "/workspace"
      );

      assert.strictEqual(results.length, 1);
      sinon.assert.calledWithMatch(
        mockStream.markdown as sinon.SinonSpy,
        /renamed/
      );
    });
  });
});
