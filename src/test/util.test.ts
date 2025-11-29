import * as assert from "assert";
import * as path from "path";
import proxyquire from "proxyquire";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { extractFilesInDirectory, filterPromptsByTarget, findPromptFiles, parsePromptFile, processDirectoryFiles, timestampAsString } from "../util";

/*
 * fs.existsSync のスタブ
 *
 * fs.existsSync は非書き換え可能であり、直接スタブを作成することができないため、
 * proxyquire を利用して fs.existsSync のスタブを作成する。
 */
const fsStub = {
  existsSync: sinon.stub(),
  statSync: sinon.stub(),
  promises: {
    stat: sinon.stub(),
  },
};
const { getUserSpecifiedDirectory, extractTargetFiles } = proxyquire("../util", { fs: fsStub });

suite("Util Test Suite", function () {
  let mockShowErrorMessage: sinon.SinonStub;

  setup(function () {
    mockShowErrorMessage = sinon.stub(vscode.window, "showErrorMessage");
  });

  teardown(function () {
    mockShowErrorMessage.restore();
  });

  suite("findPromptFiles Test Suite", function () {
    test("findPromptFiles should return .md files that do not match ignore patterns", function () {
      const directoryPath = path.normalize(path.join(__dirname, "..", "..", "src", "test", "__tests__", "utiltestdir"));
      const ignorePatterns = ["**/ignored_dir/**.md", "**/*.test.md"];

      const result = findPromptFiles(directoryPath, ignorePatterns);
      assert.deepStrictEqual(
        new Set(result),
        new Set(["file1.md", "file2.md", "dir/file3.md"].map((file) => path.join(directoryPath, file))),
      );
    });

    test("findPromptFiles should handle directory read error", function () {
      const directoryPath = "/not_exist";

      const result = findPromptFiles(directoryPath, []);
      assert.deepStrictEqual(result, []);
      sinon.assert.calledOnceWithMatch(mockShowErrorMessage, /Failed to read directory:/);
    });
  });

  suite("extractTargetFiles Test Suite", function () {
    let mockShowOpenDialog: sinon.SinonStub;
    let mockFindFiles: sinon.SinonStub;

    setup(function () {
      mockShowOpenDialog = sinon.stub(vscode.window, "showOpenDialog");
      mockFindFiles = sinon.stub(vscode.workspace, "findFiles");
      fsStub.existsSync.reset();
      fsStub.statSync.reset();
      fsStub.promises.stat.reset();
    });

    teardown(function () {
      mockShowOpenDialog.restore();
      mockFindFiles.restore();
    });

    test("extractTargetFiles がリクエストの参照からファイルパスを返すべき", async function () {
      const req = {
        prompt: "hoge",
        references: [
          {
            id: "vscode.hoge",
            value: vscode.Uri.file("/path/to/file1"),
          },
          {
            id: "vscode.fuga",
            value: vscode.Uri.file("/path/to/file2"),
          },
          {
            id: "vscode.piyo",
            value: vscode.Uri.file("/path/to/dir"),
          },
        ],
      } as unknown as vscode.ChatRequest;

      fsStub.promises.stat.withArgs("/path/to/file1").resolves({ isDirectory: () => false });
      fsStub.promises.stat.withArgs("/path/to/file2").resolves({ isDirectory: () => false });
      fsStub.promises.stat.withArgs("/path/to/dir").resolves({ isDirectory: () => true });
      mockFindFiles.resolves([vscode.Uri.file("/path/to/dir/file1.md"), vscode.Uri.file("/path/to/dir/file2.md")]);

      const stream = { markdown: sinon.stub(), progress: sinon.stub() } as unknown as vscode.ChatResponseStream;

      const result = await extractTargetFiles(req, stream);
      assert.deepStrictEqual(result, [
        "/path/to/dir/file1.md",
        "/path/to/dir/file2.md",
        "/path/to/file2",
        "/path/to/file1",
      ]);
    });

    test("extractTargetFilesが参照なしのケースを処理できるべき", async function () {
      const req = {
        prompt: "hoge #filter:*.md",
        references: [],
      } as unknown as vscode.ChatRequest;
      const stream = { markdown: sinon.stub(), progress: sinon.stub() } as unknown as vscode.ChatResponseStream;

      const result = await extractTargetFiles(req, stream);
      assert.deepStrictEqual(result, []);
    });

    test("extractTargetFilesがファイル以外のreferenceを無視すべき", async function () {
      const req = {
        prompt: "hoge",
        references: [
          {
            id: "vscode.hoge",
            value: vscode.Uri.file("/path/to/file1"),
          },
          {
            id: "vscode.fuga",
            value: vscode.Uri.file("/path/to/file2"),
          },
          {
            id: "vscode.piyo",
            value: "this is string type",
          },
        ],
      } as unknown as vscode.ChatRequest;

      fsStub.promises.stat.withArgs("/path/to/file1").resolves({ isDirectory: () => false });
      fsStub.promises.stat.withArgs("/path/to/file2").resolves({ isDirectory: () => false });
      const stream = { markdown: sinon.stub(), progress: sinon.stub() } as unknown as vscode.ChatResponseStream;

      const result = await extractTargetFiles(req, stream);
      assert.deepStrictEqual(result, ["/path/to/file2", "/path/to/file1"]);
    });

    test("extractTargetFilesが、プロンプトで#dirを指定されたときは指定ディレクトリ配下のファイルも返却すべき", async function () {
      mockShowOpenDialog.resolves([vscode.Uri.file("/path/to/directory")]);
      mockFindFiles.resolves([
        vscode.Uri.file("/path/to/directory/file1.md"),
        vscode.Uri.file("/path/to/directory/file2.md"),
      ]);

      const req = {
        prompt: "hoge #dir:/path/to/dir",
        references: [],
      } as unknown as vscode.ChatRequest;

      const stream = { markdown: sinon.stub(), progress: sinon.stub() } as unknown as vscode.ChatResponseStream;

      const result = await extractTargetFiles(req, stream);
      assert.deepStrictEqual(result, ["/path/to/directory/file1.md", "/path/to/directory/file2.md"]);
    });
  });

  suite("timestampAsString Test Suite", function () {
    const tests = [
      { date: new Date("2024-01-02T03:04:05"), expected: "20240102-030405" },
      { date: new Date("2024-01-02T23:04:05"), expected: "20240102-230405" }, // 24時間表記になることを確認
    ];

    tests.forEach(({ date, expected }) => {
      test(`timestampAsString should return ${expected} from ${date}`, function () {
        const result = timestampAsString(date);
        assert.strictEqual(result, expected);
      });
    });
  });

  suite("extractFilesInDirectory Test Suite", function () {
    let mockShowOpenDialog: sinon.SinonStub;
    let mockFindFiles: sinon.SinonStub;
    let mockMarkdown: sinon.SinonStub;

    setup(function () {
      mockShowOpenDialog = sinon.stub(vscode.window, "showOpenDialog");
      mockFindFiles = sinon.stub(vscode.workspace, "findFiles");
      mockMarkdown = sinon.stub();
    });

    teardown(function () {
      mockShowOpenDialog.restore();
      mockFindFiles.restore();
    });

    const req = {
      prompt: "hoge",
    } as unknown as vscode.ChatRequest;

    test("ディレクトリ選択がキャンセルされた場合、空の配列を返すべき", async function () {
      mockShowOpenDialog.resolves(undefined);
      const stream = { markdown: mockMarkdown } as unknown as vscode.ChatResponseStream;

      const result = await extractFilesInDirectory(req, "**/*.md", stream);
      assert.deepStrictEqual(result, []);
      sinon.assert.notCalled(mockMarkdown);
    });

    test("ディレクトリが選択されたが、フィルタパターンに一致するファイルがない場合、空の配列を返すべき", async function () {
      mockShowOpenDialog.resolves([vscode.Uri.file("/path/to/directory")]);
      mockFindFiles.resolves([]);
      const stream = { markdown: mockMarkdown } as unknown as vscode.ChatResponseStream;

      const result = await extractFilesInDirectory(req, "**/*.md", stream);
      assert.deepStrictEqual(result, []);
      sinon.assert.calledOnce(mockMarkdown);
      sinon.assert.calledWith(mockMarkdown, sinon.match.string);
    });

    test("ディレクトリが選択され、フィルタパターンに一致するファイルがある場合、ファイルパスを返すべき", async function () {
      mockShowOpenDialog.resolves([vscode.Uri.file("/path/to/directory")]);
      mockFindFiles.resolves([
        vscode.Uri.file("/path/to/directory/file1.md"),
        vscode.Uri.file("/path/to/directory/file2.md"),
      ]);
      const stream = { markdown: mockMarkdown } as unknown as vscode.ChatResponseStream;

      const result = await extractFilesInDirectory(req, "**/*.md", stream);
      assert.deepStrictEqual(result, ["/path/to/directory/file1.md", "/path/to/directory/file2.md"]);
      sinon.assert.calledThrice(mockMarkdown);
      sinon.assert.calledWith(mockMarkdown, sinon.match.string);
    });
  });

  suite("getUserSpecifiedDirectory テスト", () => {
    let mockWorkspaceFolders: sinon.SinonStub;
    setup(() => {
      fsStub.existsSync.reset();
      mockWorkspaceFolders = sinon.stub(vscode.workspace, "workspaceFolders");
    });

    teardown(() => {
      mockWorkspaceFolders.restore();
    });

    test("指定された絶対パスが存在する場合、ディレクトリパスを返すこと", () => {
      const req = { prompt: "#dir:/absolute/path/to/dir" } as vscode.ChatRequest;
      const dirPath = "/absolute/path/to/dir";
      fsStub.existsSync.withArgs(dirPath).returns(true);

      const result = getUserSpecifiedDirectory(req) as vscode.Uri;
      assert.strictEqual(result.path, dirPath);
    });

    test("指定された相対パスが存在する場合、ディレクトリパスを返すこと", () => {
      const req = { prompt: "#dir:relative/path/to/dir" } as vscode.ChatRequest;

      const workspaceRoot = "/workspace/root";
      mockWorkspaceFolders.value([{ uri: vscode.Uri.file(workspaceRoot) }]);

      const dirPath = path.join(workspaceRoot, "relative/path/to/dir");
      fsStub.existsSync.withArgs(dirPath).returns(true);

      const result = getUserSpecifiedDirectory(req) as vscode.Uri;
      assert.strictEqual(result.path, dirPath);
    });

    test("指定されたパスがダブルクォートで括られていても、ディレクトリとして扱えること", () => {
      const req = { prompt: '#dir:"relative/ path / to / dir"' } as vscode.ChatRequest;

      const workspaceRoot = "/workspace/root";
      mockWorkspaceFolders.value([{ uri: vscode.Uri.file(workspaceRoot) }]);

      const dirPath = path.join(workspaceRoot, "relative/ path / to / dir");
      fsStub.existsSync.withArgs(dirPath).returns(true);

      const result = getUserSpecifiedDirectory(req) as vscode.Uri;
      assert.strictEqual(result.path, dirPath);
    });

    test("指定されたディレクトリが存在しない場合、undefinedを返すこと", () => {
      const req = { prompt: "#dir:/non/existent/dir" } as vscode.ChatRequest;
      fsStub.existsSync.withArgs("/non/existent/dir").returns(false);

      const result = getUserSpecifiedDirectory(req);
      assert.strictEqual(result, undefined);
    });

    test("ワークスペースが開かれていない場合、undefinedを返すこと", () => {
      const req = { prompt: "#dir:relative/path/to/dir" } as vscode.ChatRequest;
      mockWorkspaceFolders.value(undefined);

      const result = getUserSpecifiedDirectory(req);
      assert.strictEqual(result, undefined);
    });

    test("プロンプトにディレクトリが指定されていない場合、undefinedを返すこと", () => {
      const req = { prompt: "no directory specified" } as vscode.ChatRequest;

      const result = getUserSpecifiedDirectory(req);
      assert.strictEqual(result, undefined);
    });
  });

  suite("processDirectoryFiles Test Suite", function () {
    let mockFindFiles: sinon.SinonStub;
    let mockMarkdown: sinon.SinonStub;
    let mockStream: vscode.ChatResponseStream;

    setup(function () {
      mockFindFiles = sinon.stub(vscode.workspace, "findFiles");
      mockMarkdown = sinon.stub();
      mockStream = { markdown: mockMarkdown } as unknown as vscode.ChatResponseStream;
    });

    teardown(function () {
      mockFindFiles.restore();
    });

    test("指定されたディレクトリ内のファイルを正常に処理し、パスを返すべき", async function () {
      const dirUri = vscode.Uri.file("/path/to/directory");
      const filterPattern = "**/*.md";
      const messagePrefix = "Test message";

      mockFindFiles.resolves([
        vscode.Uri.file("/path/to/directory/file1.md"),
        vscode.Uri.file("/path/to/directory/subdir/file2.md"),
      ]);

      const result = await processDirectoryFiles(dirUri, filterPattern, mockStream, messagePrefix);

      assert.deepStrictEqual(result, ["/path/to/directory/file1.md", "/path/to/directory/subdir/file2.md"]);

      sinon.assert.calledThrice(mockMarkdown);
      sinon.assert.calledWith(
        mockMarkdown.firstCall,
        "Test message `/path/to/directory` will be added as targets for prompt application.\n\n",
      );
      sinon.assert.calledWith(mockMarkdown.secondCall, "- directory/file1.md\n");
      sinon.assert.calledWith(mockMarkdown.thirdCall, "- directory/subdir/file2.md\n");
    });

    test("ディレクトリにファイルがない場合、空の配列を返すべき", async function () {
      const dirUri = vscode.Uri.file("/path/to/empty/directory");
      const filterPattern = "**/*.md";
      const messagePrefix = "Empty directory test";

      mockFindFiles.resolves([]);

      const result = await processDirectoryFiles(dirUri, filterPattern, mockStream, messagePrefix);

      assert.deepStrictEqual(result, []);
      sinon.assert.calledOnce(mockMarkdown);
      sinon.assert.calledWith(
        mockMarkdown,
        "Empty directory test `/path/to/empty/directory` will be added as targets for prompt application.\n\n",
      );
    });

    test("異なるフィルタパターンで正しくファイルを処理すべき", async function () {
      const dirUri = vscode.Uri.file("/project/src");
      const filterPattern = "**/*.{ts,js}";
      const messagePrefix = "JavaScript/TypeScript files";

      mockFindFiles.resolves([
        vscode.Uri.file("/project/src/main.ts"),
        vscode.Uri.file("/project/src/utils/helper.js"),
      ]);

      const result = await processDirectoryFiles(dirUri, filterPattern, mockStream, messagePrefix);

      assert.deepStrictEqual(result, ["/project/src/main.ts", "/project/src/utils/helper.js"]);

      sinon.assert.calledThrice(mockMarkdown);
      sinon.assert.calledWith(
        mockMarkdown.firstCall,
        "JavaScript/TypeScript files `/project/src` will be added as targets for prompt application.\n\n",
      );
      sinon.assert.calledWith(mockMarkdown.secondCall, "- src/main.ts\n");
      sinon.assert.calledWith(mockMarkdown.thirdCall, "- src/utils/helper.js\n");
    });

    test("相対パス表示が正しく行われるべき", async function () {
      const dirUri = vscode.Uri.file("/very/long/path/to/project");
      const filterPattern = "*.md";
      const messagePrefix = "Markdown files";

      mockFindFiles.resolves([
        vscode.Uri.file("/very/long/path/to/project/README.md"),
        vscode.Uri.file("/very/long/path/to/project/CHANGELOG.md"),
      ]);

      const result = await processDirectoryFiles(dirUri, filterPattern, mockStream, messagePrefix);

      assert.deepStrictEqual(result, [
        "/very/long/path/to/project/README.md",
        "/very/long/path/to/project/CHANGELOG.md",
      ]);

      sinon.assert.calledThrice(mockMarkdown);
      sinon.assert.calledWith(
        mockMarkdown.firstCall,
        "Markdown files `/very/long/path/to/project` will be added as targets for prompt application.\n\n",
      );
      sinon.assert.calledWith(mockMarkdown.secondCall, "- project/README.md\n");
      sinon.assert.calledWith(mockMarkdown.thirdCall, "- project/CHANGELOG.md\n");
    });

    test("単一ファイルの場合も正しく処理すべき", async function () {
      const dirUri = vscode.Uri.file("/home/user/docs");
      const filterPattern = "README.md";
      const messagePrefix = "Single file";

      mockFindFiles.resolves([vscode.Uri.file("/home/user/docs/README.md")]);

      const result = await processDirectoryFiles(dirUri, filterPattern, mockStream, messagePrefix);

      assert.deepStrictEqual(result, ["/home/user/docs/README.md"]);

      sinon.assert.calledTwice(mockMarkdown);
      sinon.assert.calledWith(
        mockMarkdown.firstCall,
        "Single file `/home/user/docs` will be added as targets for prompt application.\n\n",
      );
      sinon.assert.calledWith(mockMarkdown.secondCall, "- docs/README.md\n");
    });
  });

  suite("Front Matter Parsing Test Suite", function () {
    test("単一のapplyToパターンをパースできること", function () {
      const testFile = path.join(__dirname, "..", "..", "src", "test", "__tests__", "frontmatter", "test_prompt_java.md");
      const result = parsePromptFile(testFile);

      assert.strictEqual(result.filePath, testFile);
      assert.deepStrictEqual(result.applyToPatterns, ["*.java"]);
      assert.strictEqual(result.content.trim(), "You are an excellent Java programmer responsible for Java coding standards.");
    });

    test("複数のapplyToパターンをパースできること", function () {
      const testFile = path.join(__dirname, "..", "..", "src", "test", "__tests__", "frontmatter", "test_prompt_multi.md");
      const result = parsePromptFile(testFile);

      assert.strictEqual(result.filePath, testFile);
      assert.deepStrictEqual(result.applyToPatterns, ["*.ts", "*.tsx"]);
      assert.strictEqual(result.content.trim(), "You are a TypeScript/React expert.");
    });

    test("Front Matterがない場合は空配列を返すこと", function () {
      const testFile = path.join(__dirname, "..", "..", "src", "test", "__tests__", "frontmatter", "test_prompt_no_frontmatter.md");
      const result = parsePromptFile(testFile);

      assert.strictEqual(result.filePath, testFile);
      assert.deepStrictEqual(result.applyToPatterns, []);
      assert.strictEqual(result.content.trim(), "You are a general code reviewer responsible for all file types.");
    });

    test("Front Matter部分がコンテンツから除外されること", function () {
      const testFile = path.join(__dirname, "..", "..", "src", "test", "__tests__", "frontmatter", "test_prompt_java.md");
      const result = parsePromptFile(testFile);

      assert.strictEqual(result.content.includes("---"), false);
      assert.strictEqual(result.content.includes("applyTo"), false);
    });
  });

  suite("Prompt Filtering Test Suite", function () {
    // テスト用のワークスペースルート
    const workspaceRoot = "/workspace";

    test("ファイル拡張子に基づいてマッチングできること", function () {
      const prompts = [
        { filePath: "java.md", applyToPatterns: ["*.java"], content: "Java prompt" },
        { filePath: "python.md", applyToPatterns: ["*.py"], content: "Python prompt" },
      ];

      const result = filterPromptsByTarget(prompts, "/workspace/src/Main.java", workspaceRoot);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].filePath, "java.md");
    });

    test("applyToが未指定の場合は全プロンプトを適用すること", function () {
      const prompts = [
        { filePath: "general.md", applyToPatterns: [], content: "General prompt" },
        { filePath: "java.md", applyToPatterns: ["*.java"], content: "Java prompt" },
      ];

      const result = filterPromptsByTarget(prompts, "/workspace/src/Main.java", workspaceRoot);
      assert.strictEqual(result.length, 2);
    });

    test("Globパターンをサポートすること", function () {
      const prompts = [
        { filePath: "src_python.md", applyToPatterns: ["src/**/*.py"], content: "Source Python prompt" },
        { filePath: "test_python.md", applyToPatterns: ["test/**/*.py"], content: "Test Python prompt" },
      ];

      const result1 = filterPromptsByTarget(prompts, "/workspace/src/utils/helper.py", workspaceRoot);
      assert.strictEqual(result1.length, 1);
      assert.strictEqual(result1[0].filePath, "src_python.md");

      const result2 = filterPromptsByTarget(prompts, "/workspace/test/test_utils.py", workspaceRoot);
      assert.strictEqual(result2.length, 1);
      assert.strictEqual(result2[0].filePath, "test_python.md");
    });

    test("複数パターンをサポートすること", function () {
      const prompts = [
        { filePath: "jvm.md", applyToPatterns: ["*.java", "*.kt"], content: "JVM prompt" },
      ];

      const result1 = filterPromptsByTarget(prompts, "/workspace/src/Main.java", workspaceRoot);
      assert.strictEqual(result1.length, 1);

      const result2 = filterPromptsByTarget(prompts, "/workspace/src/Main.kt", workspaceRoot);
      assert.strictEqual(result2.length, 1);

      const result3 = filterPromptsByTarget(prompts, "/workspace/src/Main.py", workspaceRoot);
      assert.strictEqual(result3.length, 0);
    });

    test("matchBaseオプションが有効であること", function () {
      const prompts = [
        { filePath: "java.md", applyToPatterns: ["*.java"], content: "Java prompt" },
      ];

      // パス全体でなくファイル名のみでマッチング
      const result = filterPromptsByTarget(prompts, "/workspace/very/long/path/to/Main.java", workspaceRoot);
      assert.strictEqual(result.length, 1);
    });

    test("ワークスペースルートからの相対パスでマッチングされること", function () {
      const prompts = [
        { filePath: "src_ts.md", applyToPatterns: ["src/*.ts"], content: "Src TypeScript prompt" },
      ];

      // src/*.ts は src直下の.tsファイルにのみマッチ
      const result1 = filterPromptsByTarget(prompts, "/workspace/src/config.ts", workspaceRoot);
      assert.strictEqual(result1.length, 1);

      // src/subdir/file.ts にはマッチしない
      const result2 = filterPromptsByTarget(prompts, "/workspace/src/subdir/file.ts", workspaceRoot);
      assert.strictEqual(result2.length, 0);
    });
  });

  suite("Prompt Filtering with Exclusion Patterns Test Suite", function () {
    const workspaceRoot = "/workspace";

    test("基本的な除外パターン: すべての.tsxファイルから.stories.tsxを除外", function () {
      const prompts = [
        {
          filePath: "react.md",
          applyToPatterns: ["**/*.tsx", "!**/*.stories.tsx"],
          content: "React component review"
        },
      ];

      // 通常の.tsxファイル → 適用される
      const result1 = filterPromptsByTarget(prompts, "/workspace/src/Button.tsx", workspaceRoot);
      assert.strictEqual(result1.length, 1);
      assert.strictEqual(result1[0].filePath, "react.md");

      // .stories.tsxファイル → 除外される
      const result2 = filterPromptsByTarget(prompts, "/workspace/src/Button.stories.tsx", workspaceRoot);
      assert.strictEqual(result2.length, 0);
    });

    test("再度includeパターン: 特定のテストファイルのみ含める", function () {
      const prompts = [
        {
          filePath: "typescript.md",
          applyToPatterns: [
            "**/*.ts",
            "!**/*.spec.ts",
            "src/special.spec.ts"
          ],
          content: "TypeScript review"
        },
      ];

      // 通常の.tsファイル → 適用される
      const result1 = filterPromptsByTarget(prompts, "/workspace/src/app.ts", workspaceRoot);
      assert.strictEqual(result1.length, 1);

      // 一般的なテストファイル → 除外される
      const result2 = filterPromptsByTarget(prompts, "/workspace/src/app.spec.ts", workspaceRoot);
      assert.strictEqual(result2.length, 0);

      // 特別なテストファイル → 含まれる
      const result3 = filterPromptsByTarget(prompts, "/workspace/src/special.spec.ts", workspaceRoot);
      assert.strictEqual(result3.length, 1);
    });

    test("順序評価の確認: パターンの並び順で結果が変わる", function () {
      // パターン1: include → exclude の順
      const prompts1 = [
        {
          filePath: "order1.md",
          applyToPatterns: ["*.ts", "!*.spec.ts"],
          content: "Order 1"
        },
      ];
      const result1 = filterPromptsByTarget(prompts1, "/workspace/app.spec.ts", workspaceRoot);
      assert.strictEqual(result1.length, 0, "*.spec.tsは除外されるべき");

      // パターン2: exclude → include の順（逆順）
      const prompts2 = [
        {
          filePath: "order2.md",
          applyToPatterns: ["!*.spec.ts", "*.ts"],
          content: "Order 2"
        },
      ];
      const result2 = filterPromptsByTarget(prompts2, "/workspace/app.spec.ts", workspaceRoot);
      assert.strictEqual(result2.length, 1, "後のパターン*.tsが優先されて含まれるべき");
    });

    test("複雑な除外パターン: 複数階層の除外と再include", function () {
      const prompts = [
        {
          filePath: "complex.md",
          applyToPatterns: [
            "src/**/*.ts",           // srcディレクトリ配下の全.tsファイル
            "!src/test/**/*.ts",     // testディレクトリは除外
            "!src/**/*.generated.ts", // 生成ファイルは除外
            "src/test/critical.ts"   // でもこのファイルは含める
          ],
          content: "Complex review"
        },
      ];

      // 通常のsrcファイル → 含まれる
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/src/app.ts", workspaceRoot).length,
        1
      );

      // testディレクトリのファイル → 除外
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/src/test/unit.ts", workspaceRoot).length,
        0
      );

      // 生成ファイル → 除外
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/src/api.generated.ts", workspaceRoot).length,
        0
      );

      // 特別なテストファイル → 含まれる
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/src/test/critical.ts", workspaceRoot).length,
        1
      );
    });

    test("後方互換性: `!`なしの既存パターンが引き続き動作", function () {
      const prompts = [
        { filePath: "java.md", applyToPatterns: ["*.java"], content: "Java prompt" },
        { filePath: "multi.md", applyToPatterns: ["*.ts", "*.tsx"], content: "Multi prompt" },
      ];

      // 既存の動作が変わらないことを確認
      const result1 = filterPromptsByTarget(prompts, "/workspace/Main.java", workspaceRoot);
      assert.strictEqual(result1.length, 1);
      assert.strictEqual(result1[0].filePath, "java.md");

      const result2 = filterPromptsByTarget(prompts, "/workspace/app.tsx", workspaceRoot);
      assert.strictEqual(result2.length, 1);
      assert.strictEqual(result2[0].filePath, "multi.md");
    });

    test("excludeパターンのみ: includeパターンがない場合は何もマッチしない", function () {
      const prompts = [
        {
          filePath: "exclude_only.md",
          applyToPatterns: ["!*.spec.ts"],
          content: "Exclude only"
        },
      ];

      // excludeパターンのみの場合、何もマッチしない
      const result1 = filterPromptsByTarget(prompts, "/workspace/app.ts", workspaceRoot);
      assert.strictEqual(result1.length, 0);

      const result2 = filterPromptsByTarget(prompts, "/workspace/app.spec.ts", workspaceRoot);
      assert.strictEqual(result2.length, 0);
    });

    test("空配列: applyToPatternsが空の場合は全ファイル対象（後方互換性）", function () {
      const prompts = [
        { filePath: "all.md", applyToPatterns: [], content: "All files" },
      ];

      const result = filterPromptsByTarget(prompts, "/workspace/any_file.xyz", workspaceRoot);
      assert.strictEqual(result.length, 1);
    });

    test("連続する除外パターン: 複数の除外パターンが連続する場合", function () {
      const prompts = [
        {
          filePath: "multiple_exclude.md",
          applyToPatterns: [
            "**/*.ts",
            "!**/*.spec.ts",
            "!**/*.test.ts",
            "!**/*.d.ts"
          ],
          content: "Multiple excludes"
        },
      ];

      // 通常の.tsファイル → 含まれる
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/app.ts", workspaceRoot).length,
        1
      );

      // .spec.tsファイル → 除外
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/app.spec.ts", workspaceRoot).length,
        0
      );

      // .test.tsファイル → 除外
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/app.test.ts", workspaceRoot).length,
        0
      );

      // .d.tsファイル → 除外
      assert.strictEqual(
        filterPromptsByTarget(prompts, "/workspace/types.d.ts", workspaceRoot).length,
        0
      );
    });

    test("matchBaseオプションの動作確認: 除外パターンでも有効", function () {
      const prompts = [
        {
          filePath: "matchbase.md",
          applyToPatterns: ["*.ts", "!*.spec.ts"],
          content: "MatchBase test"
        },
      ];

      // 深い階層でもベース名でマッチング
      const result = filterPromptsByTarget(
        prompts,
        "/workspace/very/long/path/to/file.spec.ts",
        workspaceRoot
      );
      assert.strictEqual(result.length, 0, "深い階層でも除外パターンが効くべき");
    });
  });
});
