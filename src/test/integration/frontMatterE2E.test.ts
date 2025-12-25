import * as assert from "assert";
import path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as chatHandlerModule from "../../chatHandler";

/**
 * E2E用のChatリクエストを作成する関数
 */
function createE2EChatRequest(
  command: string,
  references: vscode.ChatPromptReference[],
  sendRequestStub: sinon.SinonStub,
): vscode.ChatRequest {
  return {
    command,
    prompt: "",
    references,
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

/**
 * ファイル参照を作成するヘルパー関数
 */
function createFileReference(filePath: string): vscode.ChatPromptReference {
  return {
    id: "vscode.file",
    value: vscode.Uri.file(filePath),
  } as vscode.ChatPromptReference;
}

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

suite("Front Matter E2E統合テスト", function () {
  let mockGetConfiguration: sinon.SinonStub;
  let sendRequestStub: sinon.SinonStub;

  // テストフィクスチャは src/ にあるため、絶対パスで指定
  const fixturesDir = path.join(__dirname, "../../../src/test/__tests__/integration_fixtures");
  const promptsDir = path.join(fixturesDir, "prompts");
  const sourcesDir = path.join(fixturesDir, "sources");

  const mockConfigReturns = {
    get: sinon.stub().callsFake((section: string) => {
      switch (section) {
        case "prompt.excludeFilePatterns":
          return [];
        case "chat.outputMode":
        case "promptis.output.mode":
          return "chat-only"; // デフォルトはchat-only
        case "chat.outputPath":
          return path.join(__dirname, "../../out/");
        case "telemetry.enable":
        case "telemetry.enableTelemetry":
          return false;
        case "codeReview.codeStandardPath":
        case "codeReview.functionalPath":
        case "codeReview.nonFunctionalPath":
        case "reverseEngineering.promptsPath":
        case "drawDiagrams.promptsPath":
          // プロンプト格納ディレクトリをテストフィクスチャに設定
          return promptsDir;
        default:
          return undefined;
      }
    }),
    has: sinon.stub().returns(true),
    inspect: sinon.stub().returns(undefined),
    update: sinon.stub().returns(Promise.resolve()),
  };

  setup(function () {
    mockGetConfiguration = sinon
      .stub(vscode.workspace, "getConfiguration")
      .returns(mockConfigReturns);

    // AI ModelのsendRequestを完全にモック化
    sendRequestStub = sinon.stub().resolves({
      text: (async function* () {
        yield "Mocked AI response";
      })(),
    });
  });

  teardown(function () {
    mockGetConfiguration.restore();
    sinon.restore();
  });

  suite("単一ファイル処理", function () {
    test("Javaファイルは Java専用プロンプトと汎用プロンプトのみを受け取る", async function () {
      const javaFile = path.join(sourcesDir, "Main.java");
      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(javaFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Java専用(1) + 汎用(1) = 2回のAI呼び出し
      assert.strictEqual(
        sendRequestStub.callCount,
        2,
        `Expected 2 AI calls (Java + General), but got ${sendRequestStub.callCount}`,
      );

      // 送信されたメッセージを検証
      const messages = [];
      for (let i = 0; i < sendRequestStub.callCount; i++) {
        const call = sendRequestStub.getCall(i);
        const promptContent = extractTextContent(call.args[0][0].content);
        messages.push(promptContent);
      }

      const hasJavaPrompt = messages.some((msg) => msg.includes("Javaコードレビュー"));
      const hasGeneralPrompt = messages.some((msg) => msg.includes("汎用セキュリティレビュー"));

      assert.ok(hasJavaPrompt, "Java専用プロンプトが含まれている");
      assert.ok(hasGeneralPrompt, "汎用プロンプトが含まれている");

      // Front Matterが除外されていることを確認
      const hasApplyTo = messages.some((msg) => msg.includes("applyTo:"));
      assert.ok(!hasApplyTo, "Front Matterがプロンプト内容から除外されている");
    });

    test("TypeScriptファイルは TypeScript専用プロンプトと汎用プロンプトのみを受け取る", async function () {
      const tsxFile = path.join(sourcesDir, "Component.tsx");
      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(tsxFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // TypeScript専用(1) + 汎用(1) = 2回
      assert.strictEqual(sendRequestStub.callCount, 2);

      const messages = [];
      for (let i = 0; i < sendRequestStub.callCount; i++) {
        const call = sendRequestStub.getCall(i);
        const promptContent = extractTextContent(call.args[0][0].content);
        messages.push(promptContent);
      }

      const hasTsPrompt = messages.some((msg) => msg.includes("TypeScript/Reactコードレビュー"));
      const hasGeneralPrompt = messages.some((msg) => msg.includes("汎用セキュリティレビュー"));

      assert.ok(hasTsPrompt, "TypeScript専用プロンプトが含まれている");
      assert.ok(hasGeneralPrompt, "汎用プロンプトが含まれている");
    });

    test("マッチするプロンプトがないJSONファイルは汎用プロンプトのみを受け取る", async function () {
      const jsonFile = path.join(sourcesDir, "data.json");
      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(jsonFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // 汎用プロンプトのみ = 1回
      assert.strictEqual(sendRequestStub.callCount, 1);

      const message = extractTextContent(sendRequestStub.getCall(0).args[0][0].content);
      assert.ok(
        message.includes("汎用セキュリティレビュー"),
        "汎用プロンプトのみが含まれている",
      );
    });
  });

  suite("複数ファイル処理", function () {
    test("複数ファイルはそれぞれ適切にフィルタリングされたプロンプトを受け取る", async function () {
      const javaFile = path.join(sourcesDir, "Main.java");
      const pythonFile = path.join(sourcesDir, "app.py");

      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(javaFile), createFileReference(pythonFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Java(2: Java専用 + 汎用) + Python(2: Python専用 + 汎用) = 4回
      assert.strictEqual(sendRequestStub.callCount, 4);

      const allMessages = [];
      for (let i = 0; i < sendRequestStub.callCount; i++) {
        const promptContent = extractTextContent(sendRequestStub.getCall(i).args[0][0].content);
        allMessages.push(promptContent);
      }

      const hasJava = allMessages.some((msg) => msg.includes("Javaコードレビュー"));
      const hasPython = allMessages.some((msg) => msg.includes("Pythonコードレビュー"));
      const generalCount = allMessages.filter((msg) =>
        msg.includes("汎用セキュリティレビュー"),
      ).length;

      assert.ok(hasJava, "Javaプロンプトが適用されている");
      assert.ok(hasPython, "Pythonプロンプトが適用されている");
      assert.strictEqual(generalCount, 2, "汎用プロンプトが両方のファイルに適用されている");
    });

    test("進捗メッセージに正しいプロンプト数が表示される", async function () {
      const javaFile = path.join(sourcesDir, "Main.java");
      const pythonFile = path.join(sourcesDir, "app.py");

      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(javaFile), createFileReference(pythonFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      const markdownCalls = (stream.markdown as sinon.SinonStub).getCalls();
      const markdownMessages = markdownCalls.map((call) => call.args[0]);

      // "Applying X prompt(s)" メッセージを探す
      const applyingMessages = markdownMessages.filter((msg: string) =>
        msg.includes("Applying") && msg.includes("prompt(s)"),
      );

      // 各ファイルについて適切なプロンプト数が表示されているか確認
      assert.ok(
        applyingMessages.some((msg: string) => msg.includes("2 prompt(s)")),
        "正しいプロンプト数が表示されている",
      );
    });
  });

  suite("出力モード統合", function () {
    test("chat-onlyモードはストリームのみに出力する", async function () {
      // chat-onlyモードはデフォルト設定で既にセットアップ済み
      const javaFile = path.join(sourcesDir, "Main.java");
      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(javaFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // streamのmarkdownメソッドが呼ばれていることを確認
      assert.ok(
        (stream.markdown as sinon.SinonStub).called,
        "chat-onlyモードでストリームのmarkdownが呼ばれている",
      );
    });

    test("file-onlyモードでもフィルタリングが機能する", async function () {
      // 設定をfile-onlyに変更
      mockConfigReturns.get.withArgs("chat.outputMode").returns("file-only");

      const tsxFile = path.join(sourcesDir, "Component.tsx");
      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(tsxFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // TS専用 + 汎用 = 2回
      assert.strictEqual(sendRequestStub.callCount, 2);
    });
  });

  suite("後方互換性", function () {
    test("Front Matterなしのプロンプトは全ファイルに適用される", async function () {
      const javaFile = path.join(sourcesDir, "Main.java");
      const jsonFile = path.join(sourcesDir, "data.json");

      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(javaFile), createFileReference(jsonFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Java: Java専用 + 汎用 = 2
      // JSON: 汎用のみ = 1
      // 合計 = 3
      assert.strictEqual(sendRequestStub.callCount, 3);

      const allMessages = [];
      for (let i = 0; i < sendRequestStub.callCount; i++) {
        const promptContent = extractTextContent(sendRequestStub.getCall(i).args[0][0].content);
        allMessages.push(promptContent);
      }

      // 汎用プロンプト（Front Matterなし）が両方に適用されている
      const generalCount = allMessages.filter((msg) =>
        msg.includes("汎用セキュリティレビュー"),
      ).length;
      assert.strictEqual(generalCount, 2, "汎用プロンプトが全ファイルに適用されている");
    });

    test("Front Matterあり/なしのプロンプトが混在しても正しく動作する", async function () {
      const pythonFile = path.join(sourcesDir, "app.py");

      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(pythonFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // Python専用(Front Matterあり) + 汎用(Front Matterなし) = 2
      assert.strictEqual(sendRequestStub.callCount, 2);

      const messages = [];
      for (let i = 0; i < sendRequestStub.callCount; i++) {
        const promptContent = extractTextContent(sendRequestStub.getCall(i).args[0][0].content);
        messages.push(promptContent);
      }

      const hasPython = messages.some((msg) => msg.includes("Pythonコードレビュー"));
      const hasGeneral = messages.some((msg) => msg.includes("汎用セキュリティレビュー"));

      assert.ok(hasPython, "Python専用プロンプトが適用されている");
      assert.ok(hasGeneral, "汎用プロンプト（Front Matterなし）が適用されている");
    });
  });

  suite("エッジケース", function () {
    test("マッチする専用プロンプトがないファイルは適切なカウントを表示する", async function () {
      const jsonFile = path.join(sourcesDir, "data.json");

      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(jsonFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      const markdownCalls = (stream.markdown as sinon.SinonStub).getCalls();
      const markdownMessages = markdownCalls.map((call) => call.args[0]);

      // "Applying 1 prompt(s)" が表示されているはず（汎用プロンプトのみ）
      const applyingMessage = markdownMessages.find((msg: string) =>
        msg.includes("Applying") && msg.includes("prompt(s)"),
      );

      assert.ok(applyingMessage, "適用メッセージが表示されている");
      assert.ok(
        applyingMessage.includes("1 prompt(s)"),
        "JSONファイルには1個のプロンプトのみが表示されている",
      );
    });

    test("Front Matterの内容がAIリクエストから完全に除外されている", async function () {
      const javaFile = path.join(sourcesDir, "Main.java");

      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(javaFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // 全ての呼び出しでFront Matter（---で囲まれた部分）が含まれていないことを確認
      for (let i = 0; i < sendRequestStub.callCount; i++) {
        const promptContent = extractTextContent(sendRequestStub.getCall(i).args[0][0].content);
        assert.ok(!promptContent.includes("---"), "Front Matterの区切り文字が含まれていない");
        assert.ok(!promptContent.includes("applyTo:"), "applyToフィールドが含まれていない");
      }
    });

    test("ソースファイルの内容が2番目のメッセージとして正しく送信される", async function () {
      const pythonFile = path.join(sourcesDir, "app.py");

      const request = createE2EChatRequest(
        "codereviewCodeStandards",
        [createFileReference(pythonFile)],
        sendRequestStub,
      );
      const stream = createMockStream();
      const token = {} as vscode.CancellationToken;

      await chatHandlerModule.chatHandler(request, {} as vscode.ChatContext, stream, token);

      // 各呼び出しで2つのメッセージ（プロンプト + ソースコード）が送信されていることを確認
      for (let i = 0; i < sendRequestStub.callCount; i++) {
        const messages = sendRequestStub.getCall(i).args[0];
        assert.strictEqual(messages.length, 2, "プロンプトとソースコードの2つのメッセージが送信されている");

        // 2番目のメッセージにソースコードが含まれている
        const sourceContent = extractTextContent(messages[1].content);
        assert.ok(
          sourceContent.includes("def calculate_sum"),
          "2番目のメッセージにソースコードが含まれている",
        );
      }
    });
  });
});
