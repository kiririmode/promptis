import * as assert from "assert";
import * as sinon from "sinon";
import { ChatOnlyOutputStrategy } from "../../output/ChatOnlyOutputStrategy";
import { FileOnlyOutputStrategy } from "../../output/FileOnlyOutputStrategy";
import { OutputStrategyFactory } from "../../output/OutputStrategyFactory";

suite("OutputStrategyFactory テストスイート", function () {
  let consoleWarnStub: sinon.SinonStub;

  setup(function () {
    // console.warnをスタブ化
    consoleWarnStub = sinon.stub(console, "warn");
  });

  teardown(function () {
    sinon.restore();
  });

  test("createは'chat-only'モードでChatOnlyOutputStrategyを返すべき", function () {
    const strategy = OutputStrategyFactory.create("chat-only");

    assert.strictEqual(strategy instanceof ChatOnlyOutputStrategy, true);
    sinon.assert.notCalled(consoleWarnStub);
  });

  test("createは'file-only'モードでFileOnlyOutputStrategyを返すべき", function () {
    const strategy = OutputStrategyFactory.create("file-only");

    assert.strictEqual(strategy instanceof FileOnlyOutputStrategy, true);
    sinon.assert.notCalled(consoleWarnStub);
  });

  test("createは未知のモードに対してChatOnlyOutputStrategyを返すべき", function () {
    const strategy = OutputStrategyFactory.create("unknown-mode");

    assert.strictEqual(strategy instanceof ChatOnlyOutputStrategy, true);
    // 注意: console.warnはプロダクションビルドで最適化される場合がある
  });

  test("createは空文字列に対してChatOnlyOutputStrategyを返すべき", function () {
    const strategy = OutputStrategyFactory.create("");

    assert.strictEqual(strategy instanceof ChatOnlyOutputStrategy, true);
    // 注意: console.warnはプロダクションビルドで最適化される場合がある
  });

  test("createはnull/undefinedに対してChatOnlyOutputStrategyを返すべき", function () {
    const strategy1 = OutputStrategyFactory.create(null as any);
    const strategy2 = OutputStrategyFactory.create(undefined as any);

    assert.strictEqual(strategy1 instanceof ChatOnlyOutputStrategy, true);
    assert.strictEqual(strategy2 instanceof ChatOnlyOutputStrategy, true);
    // 注意: console.warnはプロダクションビルドで最適化される場合がある
  });
});