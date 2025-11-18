import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { FileChatResponseStreamWrapper } from "../../chatutil";
import { FileOnlyOutputStrategy } from "../../output/FileOnlyOutputStrategy";

suite("FileOnlyOutputStrategy テストスイート", function () {
  let mockStream: vscode.ChatResponseStream;
  let mockFileChatStream: FileChatResponseStreamWrapper;
  let strategy: FileOnlyOutputStrategy;

  setup(function () {
    // 通常のモックストリームを作成
    mockStream = {
      markdown: sinon.stub(),
      anchor: sinon.stub(),
      button: sinon.stub(),
      filetree: sinon.stub(),
      progress: sinon.stub(),
      reference: sinon.stub(),
      push: sinon.stub(),
    } as vscode.ChatResponseStream;

    // ファイルチャットストリームのモックを作成
    mockFileChatStream = {
      markdown: sinon.stub(),
      writeDirectToFile: sinon.stub(),
      anchor: sinon.stub(),
      button: sinon.stub(),
      filetree: sinon.stub(),
      progress: sinon.stub(),
      reference: sinon.stub(),
      push: sinon.stub(),
    } as unknown as FileChatResponseStreamWrapper;

    strategy = new FileOnlyOutputStrategy();
  });

  teardown(function () {
    sinon.restore();
  });

  test("outputProgressは最初の呼び出し時のみサマリーを表示すべき", function () {
    // 最初の呼び出し（counter = 0）
    strategy.outputProgress(0, 5, mockStream);

    sinon.assert.calledTwice(mockStream.markdown as sinon.SinonSpy);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "📝 Starting review for 5 file(s). Results will be saved to file.\n");
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "----\n");

    // mockStreamをリセット
    (mockStream.markdown as sinon.SinonSpy).resetHistory();

    // 2回目以降の呼び出し（counter = 1）
    strategy.outputProgress(1, 5, mockStream);

    // 2回目以降は何も出力されない
    sinon.assert.notCalled(mockStream.markdown as sinon.SinonSpy);
  });

  test("outputReviewDetailsはワークスペース有りの場合、最小限の進捗を表示すべき", function () {
    const promptFile = "/workspace/prompts/test.md";
    const contentFilePath = "/workspace/src/test.ts";

    // ワークスペースをモック
    const mockWorkspaceFolder = { uri: { fsPath: "/workspace" } };
    sinon.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

    strategy.outputReviewDetails(promptFile, contentFilePath, mockStream);

    sinon.assert.calledOnce(mockStream.markdown as sinon.SinonSpy);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "✅ prompts/test.md → src/test.ts\n");
  });

  test("outputReviewDetailsはワークスペース無しの場合、最小限の進捗を表示すべき", function () {
    const promptFile = "/prompts/test.md";
    const contentFilePath = "/src/test.ts";

    // ワークスペース無しをモック
    sinon.stub(vscode.workspace, "workspaceFolders").value(undefined);

    strategy.outputReviewDetails(promptFile, contentFilePath, mockStream);

    sinon.assert.calledOnce(mockStream.markdown as sinon.SinonSpy);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "✅ test.md → test.ts\n");
  });

  test("outputReviewResultはFileChatResponseStreamWrapperに対してwriteDirectToFileを使用すべき", async function () {
    // writeDirectToFileメソッドを持つモックを作成
    const fileChatStream = {
      writeDirectToFile: sinon.stub(),
      markdown: sinon.stub(),
    };
    // instanceofチェックを通すため、prototypeを偽装
    Object.setPrototypeOf(fileChatStream, FileChatResponseStreamWrapper.prototype);

    const fragments = (async function* () {
      yield "fragment1";
      yield "fragment2";
      yield "fragment3";
    })();

    await strategy.outputReviewResult(fragments, fileChatStream as any);

    // writeDirectToFileが呼ばれることを確認
    sinon.assert.calledThrice(fileChatStream.writeDirectToFile);
    sinon.assert.calledWith(fileChatStream.writeDirectToFile, "fragment1");
    sinon.assert.calledWith(fileChatStream.writeDirectToFile, "fragment2");
    sinon.assert.calledWith(fileChatStream.writeDirectToFile, "fragment3");

    // markdownは呼ばれない
    sinon.assert.notCalled(fileChatStream.markdown);
  });

  test("outputReviewResultは通常のChatResponseStreamに対してmarkdownにフォールバックすべき", async function () {
    const fragments = (async function* () {
      yield "fragment1";
      yield "fragment2";
    })();

    await strategy.outputReviewResult(fragments, mockStream);

    // 通常のStreamの場合はmarkdownが呼ばれる
    sinon.assert.calledTwice(mockStream.markdown as sinon.SinonSpy);
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "fragment1");
    sinon.assert.calledWith(mockStream.markdown as sinon.SinonSpy, "fragment2");
  });
});