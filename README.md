# promptis README

![test](https://github.com/Fintan-contents/promptis/actions/workflows/test.yaml/badge.svg) ![Coverage](https://raw.githubusercontent.com/Fintan-contents/promptis/refs/heads/gh-pages/coverage/badge.png)

> [!NOTE]
> For English version, please refer to [README-en.md](https://github.com/Fintan-contents/promptis/blob/main/README-en.md).

GitHub Copilot Chatは実装に関する質問をプロンプトで行うことができますが、このプロンプトを逐一打ち込む負荷が高いことによって次のような問題が生じていました。

- **時間と生産性の問題**
  - 頻繁なプロンプト入力によりコーディングが中断され、集中力の低下や生産性の減少を招く
  - コンテキストの再説明に時間を要し、作業フローの非効率化につながる
- **品質と一貫性の問題**
  - 短いプロンプトでは開発者の意図を完全に伝えきれず、生成されるコードの品質や適切性が低下する
  - 異なるプロンプトの使用により、生成されるコードのスタイルや方針に一貫性がなくなり、プロジェクト全体の統一性が損なわれる

Promptisは、これらの問題を解決するために、GitHub Copilot Chatを活用してプロンプト実行を半自動化するVisual Studio Code (VS Code) Extensionです。

![デモ動画](./mermaid.gif)

## Merits

- **プロンプト入力の手間を軽減**: プロンプトの自動実行により、手動での入力作業を減らし、開発に集中できる
- **一貫性のあるコードレビュー**: プロンプトの統一により、コードの品質と一貫性を向上
- **迅速なフィードバック**: プロンプトの自動実行により、コードレビューやフィードバックの速度が向上し、開発サイクルが短縮される

## How to Install

### インターネット経由でインストールする場合

[Extensions for Visual Studio Code](https://marketplace.visualstudio.com/vscode)のPromptisからインストールしてください。

- [Promptis - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tis.promptis)

### インターネットに接続できない端末にインストールする場合

1. インターネットに接続できる端末を用いて、[Release](https://github.com/Fintan-contents/promptis/releases)ページからExtensionの実体である`.vsix`ファイルをダウンロードしてください。
2. ダウンロードした`.vsix`ファイルをインターネットに接続できない端末に配布してください。
3. 接続できない端末において、VS Codeの「拡張機能」メニューの「VSIX からのインストール」から`vsix`ファイルをインストールしてください。
    - 詳細は[Install from a VSIX](https://code.visualstudio.com/docs/editor/extension-marketplace#_install-from-a-vsix)を参照してください。

## Usage

Promptisは、GitHub Copilot Chatを利用してプロンプト実行を半自動化するためのExtensionです。

ソースコードや設定ファイルに対するレビュー観点等のプロンプトをMarkdownファイル（群）としてディレクトリに準備しておき、
Chatウィンドウから @promptis に対して指示（コマンド）を出すことで、そのコマンドに対応するプロンプトを連続して実行することができます。例えば、`chatHandler.ts`と`api.ts`に対してコード基準を満たしているかをレビューさせる場合は、次のように指示します。

```text
@promptis /codereviewCodeStandards #file:chatHandler.ts #file:api.ts
```

`/codereviewCodeStandards`等のコマンドと、プロンプト格納ディレクトリが1:1に対応しており、その配下にあるプロンプトファイル（拡張子: `.md`)をPromptisが再帰的に読み込み、連続実行します。

指示できるコマンドは次のとおりです。

### コマンドマップ

| コマンド名                      | 実行内容                                      |
|---------------------------------|-----------------------------------------------|
| `codereviewCodeStandards`       | コード基準に関する一連のコードレビューを行う |
| `codereviewFunctional`          | 機能観点のコードレビューを行う |
| `codereviewNonFunctional`       | 非機能観点のコードレビューを行う |
| `reverseEngineering`  | ソースコードに対するリバースエンジニアリングを行う |
| `drawDiagrams`                  | ソースコードから図式を作成する |

プロンプト例については、[生成AI エンジニアリング活用ガイド](https://fintan-contents.github.io/gai-dev-guide/prompts)にも公開しており、圧縮ファイルは[こちら](https://github.com/Fintan-contents/gai-dev-guide/releases)からダウンロードいただけます。

### チャット変数

GitHub Copilot Chatで利用できる`#file`や`#selection`などの[チャット変数](https://code.visualstudio.com/docs/copilot/copilot-chat#_chat-context)はそのままご利用いただけます。  
Promptisではさらに、次のチャット変数を利用できます。

| チャット変数 | 説明 | 例 |
| ------------ | ---- | -- |
| `#dir:[Directory]` | プロンプト中に`#dir`を含めることで、プロンプトを適用するディレクトリを指定できる。指定したディレクトリ配下の全ファイルに対してプロンプトが実行される。また、`#dir:path/to/dir`の形式で直接ディレクトリを指定することも可能。 | `@promptis /codereviewCodeStandards #dir` |
| `#filter:[GlobPattern]` | プロンプト中に`#filter:[GlobPattern]`を含めることで、`#dir`指定によって抽出されたファイルのうち、GlobPatternに合致するもののみを適用対象として絞り込める。指定できるパターンについては[GlobPattern](https://code.visualstudio.com/api/references/vscode-api#GlobPattern)を参照。 | `@promptis /codereviewCodeStandards #dir #filter:**/*.{ts,js}`

## Requirements

- [VS Code](https://code.visualstudio.com/) が[version.1.91.0](https://code.visualstudio.com/updates/v1_91)以降
  - Chat、Language Model APIを利用するため
- 次のExtensionがインストール済であること
  - [GitHub Copilot Extension](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot)
  - [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat)

## Extension Settings

| 設定項目 | type | デフォルト値 | 設定内容 |
|--|--|--|--|
| `codeReview.codeStandardPath`     | string   |  | コードレビュープロンプト格納ディレクトリの絶対パス（コード基準観点） |
| `codeReview.functionalPath`       | string   |  | コードレビュープロンプト格納ディレクトリの絶対パス（機能観点） |
| `codeReview.nonFunctionalPath`    | string   |  | コードレビュープロンプト格納ディレクトリの絶対パス（非機能観点） |
| `reverseEngineering.promptsPath`  | string   |  | リバースエンジニアリング用プロンプト格納ディレクトリの絶対パス |
| `drawDiagrams.promptsPath`        | string   |  | 図式生成用のプロンプト用ディレクトリの絶対パス |
| `prompt.excludeFilePatterns`      | array of string | | プロンプト格納ディレクトリ配下のプロンプトファイルのうち、実行しないファイル名のパターン（ex., `**/dir/*.md`）。記述できるパターンは[minimatch-cheat-sheet](https://github.com/motemen/minimatch-cheat-sheet)を参照。 |
| `chat.outputPath`                 | string   |  | チャット内容のバックアップ出力先ディレクトリの絶対パス |
| `telemetry.enable`                | boolean  | true | 利用状況を示すテレメトリ情報の送信可否 |

## Telemetry

本Extensionは、利用状況を収集し本Extensionの改善を図る目的で、テレメトリを弊社サーバに送信します。収集するデータは次のとおりで、個人を特定する情報は含まれません。

| 項目名 | 説明 | 具体例 |
|--|--|--|
| 実行コマンド | 上述の「コマンドマップ」で示すコマンド名 | `codereviewCodeStandards` |
| 言語設定 | ユーザのVS Codeの言語設定 | `en` |
| VS Codeのバージョン | ユーザのVS Codeのバージョン | `1.94.1` |
| OS | ユーザのOS | `linux` |
| 本拡張のID | 本拡張のID | `tis.promptis` |
| 本拡張のバージョン | 本拡張のバージョン | `1.0.0` |
| マシンID | VS Codeをインストールしたマシンを識別するID。ユーザのプライバシーを保護するため、VS Codeが生成するハッシュ化された値を使用。| `3917c36ba8b94f2521fda9b5f94b783364a838148a87e5cfa3506eb6690e69a5` |

なお、テレメトリ送信はユーザ設定で無効化できます。

- VS Code全体でテレメトリを無効にしたい場合は[`telemetry.telemetryLevel`](https://code.visualstudio.com/docs/getstarted/telemetry)を参照の上、望む値へ変更してください。
- 本Extensionのテレメトリのみ無効にしたい場合は、Promptisの`telemetry.enable`設定を`false`に変更してください。

## Support

- VS Codeの最新バージョンを含め２世代前までのバージョンをサポートします
- 本Extensionのバグや機能要望については、[Issues](https://github.com/Fintan-contents/promptis/issues)にて受け付けています

## License

[Apache-2.0 License](./LICENSE)

## Acknowledgements

TIS株式会社 産業ビジネス第３事業部 産業モダナイゼーションビジネス部の津田 浩一氏、中泉 卓馬氏に心より感謝申し上げます。  
お二人は本Extensionのオリジナル実装を行い、その成果創出とOSS公開に大きく貢献してくださいました。
