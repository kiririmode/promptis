import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ChatOnlyOutputStrategy } from "../../output/ChatOnlyOutputStrategy";

suite("ChatOnlyOutputStrategy テストスイート", function () {
  let mockStream: vscode.ChatResponseStream;
  let strategy: ChatOnlyOutputStrategy;

  setup(function () {
    // モックストリームを作成
    mockStream = {
      markdown: sinon.stub(),
      anchor: sinon.stub(),
      button: sinon.stub(),
      filetree: sinon.stub(),
      progress: sinon.stub(),
      reference: sinon.stub(),
      push: sinon.stub(),
    } as vscode.ChatResponseStream;
    strategy = new ChatOnlyOutputStrategy();
  });

  teardown(function () {
    sinon.restore();
  });

  test("outputProgressは詳細な進捗情報を出力すべき", function () {
    const counter = 2;
    const total = 5;

    strategy.outputProgress(counter, total, mockStream);

    sinon.assert.calledTwice(mockStream.markdown as sinon.SinonSpy);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `progress: ${counter + 1}/${total}\n`);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `----\n`);
  });

  test("outputReviewDetailsはワークスペース有りの場合、詳細なレビュー情報を出力すべき", function () {
    const promptFile = "/workspace/prompts/test.md";
    const contentFilePath = "/workspace/src/test.ts";

    // ワークスペースをモック
    const mockWorkspaceFolder = { uri: { fsPath: "/workspace" } };
    sinon.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

    strategy.outputReviewDetails(promptFile, contentFilePath, mockStream);

    sinon.assert.callCount(mockStream.markdown as sinon.SinonSpy, 4);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `## Review Details \n\n`);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `- Prompt: prompts/test.md\n`);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `- Target: src/test.ts\n`);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `----\n`);
  });

  test("outputReviewDetailsはワークスペース無しの場合、絶対パスを出力すべき", function () {
    const promptFile = "/prompts/test.md";
    const contentFilePath = "/src/test.ts";

    // ワークスペース無しをモック
    sinon.stub(vscode.workspace, "workspaceFolders").value(undefined);

    strategy.outputReviewDetails(promptFile, contentFilePath, mockStream);

    sinon.assert.callCount(mockStream.markdown as sinon.SinonSpy, 4);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `## Review Details \n\n`);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `- Prompt: ${promptFile}\n`);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `- Target: ${contentFilePath}\n`);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, `----\n`);
  });

  test("outputReviewResultは全ての断片をチャットウィンドウに出力すべき", async function () {
    const fragments = (async function* () {
      yield "fragment1";
      yield "fragment2";
      yield "fragment3";
    })();

    await strategy.outputReviewResult(fragments, mockStream);

    sinon.assert.calledThrice(mockStream.markdown as sinon.SinonSpy);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "fragment1");
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "fragment2");
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "fragment3");
  });
});