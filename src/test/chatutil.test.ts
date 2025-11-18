import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode"; // Add this line to import the vscode namespace
import { FileChatResponseStreamWrapper } from "../chatutil";

suite("FileChatResponseStream Test Suite", function () {
  let mockOriginalStream: vscode.ChatResponseStream;

  setup(function () {
    mockOriginalStream = {
      markdown: sinon.stub(),
      anchor: sinon.stub(),
      button: sinon.stub(),
      filetree: sinon.stub(),
      progress: sinon.stub(),
      reference: sinon.stub(),
      push: sinon.stub(),
    } as vscode.ChatResponseStream;
  });

  teardown(function () {});

  test("FileChatResponseStream constructor should initialize properties", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);

    assert.strictEqual(stream["originalStream"], mockOriginalStream);
    assert.strictEqual(stream["filePath"], filePath);
    assert.deepStrictEqual(stream["content"], []);
  });

  test("FileChatResponseStream markdown method should add content and call original stream", function () {
    const filePath = path.normalize(`${__dirname}/../../out/test1`);
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    const markdownContent = "test markdown";

    stream.markdown(markdownContent);

    assert.deepStrictEqual(stream["content"], [markdownContent]);
    sinon.assert.calledOnce(mockOriginalStream.markdown as sinon.SinonSpy);
    sinon.assert.calledWith(mockOriginalStream.markdown as sinon.SinonSpy);
  });

  test("FileChatResponseStream writeToFile method should write content to file", function () {
    const filePath = path.normalize(`${__dirname}/../../out/test2`);
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    stream["content"] = ["line1", "line2"];

    stream.writeToFile();
  });

  test("writeToFile should handle errors gracefully", function () {
    const filePath = path.normalize(`${__dirname}/../../out`);
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    stream["content"] = ["line1", "line2"];
    const error = new Error("Test error");

    assert.throws(
      () => stream.writeToFile(),
      (error: Error) => {
        return error.message.match(/illegal operation on a directory/) !== null;
      },
    );
  });

  test("FileChatResponseStream anchor method should call original stream's anchor", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    const value = vscode.Uri.parse("testValue");
    const title = "testTitle";

    stream.anchor(value, title);

    sinon.assert.calledOnce(mockOriginalStream.anchor as sinon.SinonSpy);
    sinon.assert.calledWith(mockOriginalStream.anchor as sinon.SinonSpy, value, title);
  });

  test("FileChatResponseStream button method should call original stream's button", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    const command = { command: "testCommand" } as vscode.Command;

    stream.button(command);

    sinon.assert.calledOnce(mockOriginalStream.button as sinon.SinonSpy);
    sinon.assert.calledWith(mockOriginalStream.button as sinon.SinonSpy, command);
  });

  test("FileChatResponseStream filetree method should call original stream's filetree", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    const value = [{ name: "testName", children: [] }] as vscode.ChatResponseFileTree[];
    const baseUri = vscode.Uri.file("test/baseUri");

    stream.filetree(value, baseUri);

    sinon.assert.calledOnce(mockOriginalStream.filetree as sinon.SinonSpy);
    sinon.assert.calledWith(mockOriginalStream.filetree as sinon.SinonSpy, value, baseUri);
  });

  test("FileChatResponseStream progress method should call original stream's progress", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    const value = "testProgress";

    stream.progress(value);

    sinon.assert.calledOnce(mockOriginalStream.progress as sinon.SinonSpy);
    sinon.assert.calledWith(mockOriginalStream.progress as sinon.SinonSpy, value);
  });

  test("FileChatResponseStream reference method should call original stream's reference", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    const value = vscode.Uri.file("test/reference");
    const iconPath = vscode.Uri.file("test/iconPath");

    stream.reference(value, iconPath);

    sinon.assert.calledOnce(mockOriginalStream.reference as sinon.SinonSpy);
    sinon.assert.calledWith(mockOriginalStream.reference as sinon.SinonSpy, value, iconPath);
  });

  test("FileChatResponseStream push method should call original stream's push", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);
    const part = { type: "testPart" } as unknown as vscode.ChatResponsePart;

    stream.push(part);

    sinon.assert.calledOnce(mockOriginalStream.push as sinon.SinonSpy);
    sinon.assert.calledWith(mockOriginalStream.push as sinon.SinonSpy, part);
  });

  test("clearContentメソッドがcontent配列をクリアすること", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);

    // コンテンツを追加
    stream.markdown("test content 1");
    stream.markdown("test content 2");
    assert.strictEqual(stream["content"].length, 2);

    // コンテンツをクリア
    stream.clearContent();
    assert.strictEqual(stream["content"].length, 0);
    assert.deepStrictEqual(stream["content"], []);
  });

  test("disposeメソッドがcontent配列をクリアすること", function () {
    const filePath = "test/path";
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);

    // コンテンツを追加
    stream.markdown("test content 1");
    stream.markdown("test content 2");
    assert.strictEqual(stream["content"].length, 2);

    // リソースを解放
    stream.dispose();
    assert.strictEqual(stream["content"].length, 0);
    assert.deepStrictEqual(stream["content"], []);
  });

  test("writeToFileメソッドが書き込み後にコンテンツをクリアすること", function () {
    const filePath = path.normalize(`${__dirname}/../../out/test_clear_content`);
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);

    // コンテンツを追加
    stream.markdown("test content 1");
    stream.markdown("test content 2");
    assert.strictEqual(stream["content"].length, 2);

    // ファイルに書き込み
    stream.writeToFile();

    // 書き込み後にコンテンツがクリアされていること
    assert.strictEqual(stream["content"].length, 0);
    assert.deepStrictEqual(stream["content"], []);
  });

  test("writeToFileメソッドを複数回呼び出すと全ての内容がファイルに追記されること", function () {
    const filePath = path.normalize(`${__dirname}/../../out/test_append_mode`);
    const stream = new FileChatResponseStreamWrapper(mockOriginalStream, filePath);

    // テスト前にファイルが存在する場合は削除
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 1回目の書き込み
    stream.markdown("1つ目の内容\n");
    stream.writeToFile();
    assert.strictEqual(stream["content"].length, 0); // メモリはクリアされている

    // 2回目の書き込み
    stream.markdown("2つ目の内容\n");
    stream.writeToFile();
    assert.strictEqual(stream["content"].length, 0); // メモリはクリアされている

    // 3回目の書き込み
    stream.markdown("3つ目の内容\n");
    stream.writeToFile();
    assert.strictEqual(stream["content"].length, 0); // メモリはクリアされている

    // ファイルには全ての内容が追記されていることを確認
    const fileContent = fs.readFileSync(filePath, "utf8");
    assert.strictEqual(fileContent, "1つ目の内容\n2つ目の内容\n3つ目の内容\n");

    // テスト後のクリーンアップ
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
});
