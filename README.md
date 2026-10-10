# Kura（蔵）

**PostgreSQLの構造・権限・マスターデータを、ブラウザーで見渡せるドキュメントに。**

**v0.1.0 プレビュー版**。Kuraは、DBから情報を取得してJSONと単一HTMLを生成するツールです。テーブルの設計やリレーション、ビューの定義、アカウントの権限を一か所で確認できます。

生成したHTMLはファイルを開くだけで閲覧できます。ライブラリとデータを同梱しているため、オフラインでも利用でき、閲覧時にNode.jsやDB接続は必要ありません。GitLab Pagesにも配置できます。

```text
PostgreSQL + 取得設定
        ↓
      Kura
        ↓
 schema.json + index.html
                  ↓
        ブラウザー / GitLab Pages
```

現在はPostgreSQL 17からの取得に対応しています。TypeORMのマイグレーション解析、YAML出力、Markdown生成、LLM連携は未実装です。

## できること

| 対象                   | 確認できる情報                                                                 |
| ---------------------- | ------------------------------------------------------------------------------ |
| データベース           | バージョン、所有者、エンコーディング、照合順序、設定、拡張機能                 |
| スキーマ               | 所有者、所属するテーブル・ビュー、ロールごとのアクセス権限と付与経路           |
| テーブル               | カラム型、NOT NULL、デフォルト値、コメント、主キー・外部キー                   |
| インデックス           | キー・式、方式、UNIQUE、INCLUDE、部分条件、定義SQL                             |
| ビュー                 | カラム、定義SQL、直接の依存先・参照元                                          |
| マテリアライズドビュー | ビューの情報に加え、データ格納状態とインデックス                               |
| アカウント・ロール     | ログイン可否、Superuser、INHERIT、所属ロール、DB・スキーマ・テーブルの実効権限 |
| マスターデータ         | 設定したテーブルの値。取得カラム、並び順、最大件数を指定可能                   |
| 論理リレーション       | 外部キー制約のない参照を、根拠・確認状態とともに明示登録                       |

DB → スキーマ → テーブル・ビューのツリーから移動できます。選択した対象とタブはURLの `#` に反映され、同じHTMLのURLを共有するとその画面を開けます。

### ER図

Overviewでは全スキーマのER図、スキーマページでは所属するテーブルのER図、テーブルページではそのテーブルと直接の参照先・参照元を表示します。スキーマごとの囲い、全画面表示、ズーム・ドラッグ移動、全体表示に対応しています。図中のアイコンからテーブルのカラム定義へ移動できます。

「書き出し」では次の形式を選べます。画像には図全体を出力し、テーブルへ移動する操作アイコンは含めません。

- **JPEG**：長辺2400px。
- **SVG（標準）**：初期選択。図の元のサイズで出力。
- **SVG（高精細）**：出力サイズを縦横2倍に指定。どちらのSVGもベクター形式です。
- **MMD**：表示に使ったMermaid定義。

描画にはMermaidと内蔵ELK、操作にはPanzoomを使用します。バージョンと設定、出力順を固定しています。

## まず試す：DB接続不要

生成・開発には **Node.js 22.12以降** とnpmを使います。以下はリポジトリのルートで実行してください。

```sh
npm ci
npm run build
```

`dist/index.html` をブラウザーで開くと、サンプルのDBドキュメントを閲覧できます。このコマンドは実DBに接続せず、`examples/schema.json` と `examples/annotations.json` から生成します。

サンプルの説明を編集する場合は `./kura edit --config examples/viewer.config.json` を実行してください。保存先は `.local/annotations.json`、編集用HTMLは `.local/viewer/index.html` です。公開デモの `dist/index.html` と分けて管理します。`npm run build` は公開用の `examples/annotations.json` を使います。

## 自分のDBから生成する

### 1. 取得設定を作る

リポジトリのルートに `kura.config.json` を作成します。

```json
{
  "connectionEnv": "KURA_DATABASE_URL",
  "schemas": ["public"],
  "output": "dist/database"
}
```

### 2. 接続先を設定して生成する

```sh
export KURA_DATABASE_URL='postgresql://user:password@host:5432/database'
./kura generate --config kura.config.json
```

接続情報は設定ファイルへ書かず、`connectionEnv` で指定した環境変数から読み取ります。生成には接続先へのネットワークアクセスとメタデータの読み取り権限が必要です。マスターデータを取得する場合は、対象カラムのSELECT権限も必要です。

### 3. HTMLを開く

```text
dist/database/
├── index.html       # データとライブラリを同梱したビューアー
├── schema.json      # 取得したDB情報
└── THIRD_PARTY.txt  # 同梱ライブラリのライセンス表記
```

`index.html` をブラウザーで開いてください。DB情報は生成時点のスナップショットです。更新を反映するには、同じ生成コマンドを再実行します。

HTMLとJSONにはスキーマ・権限・指定したマスターの値が含まれます。共有先は、それらの情報を閲覧できる範囲にしてください。DB接続文字列は出力に含めません。

### 設定項目

| 項目                 | 必須 | 内容                                                                            |
| -------------------- | ---- | ------------------------------------------------------------------------------- |
| `connectionEnv`      | ✓    | 接続文字列を設定した環境変数名                                                  |
| `schemas`            | ✓    | 取得するスキーマ名の配列                                                        |
| `output`             |      | 出力先。設定ファイルからの相対パス。省略時は `kura-output`                      |
| `annotationsFile`    |      | コメントファイルのパス。設定ファイルからの相対パス。省略時は `annotations.json` |
| `environment`        |      | ドキュメントの環境名。省略時はDB名                                              |
| `roles`              |      | 表示対象のロール。省略時は `pg_` で始まるもの以外                               |
| `masters`            |      | マスターとして値を取得するテーブル、カラム、並び順、件数                        |
| `logicalRelations`   |      | 外部キー制約のない参照の定義                                                    |
| `includeRuntimeInfo` |      | `true` ならDB容量をJSONに追加。通常の画面では表示しません                       |

マスターや論理参照を指定する例は [テストDBの設定](examples/test-db/config.json) を参照してください。

マスターの件数上限は1〜10,000件、既定値は1,000件です。並び順には `orderBy`、省略時には主キーを使います。取得上限を超えた場合は、JSONに全件ではないことを記録します。

`logicalRelations` の `confirmed` は設定した人の確認状態です。Kuraがデータ整合性を検査したことを表すものではありません。カラム名からの自動推測も行いません。

## コメントを編集する

DB・スキーマ・テーブル（ビューを含む）・カラムのコメントを、ローカルの編集画面から変更できます。

まずDBから生成し、その後に編集サーバーを起動します。編集時はDBへの接続は不要です。

```sh
./kura edit --config kura.config.json
```

表示された `http://127.0.0.1:4173/` を開き、対象の鉛筆アイコンからコメントを入力してください。入力を約0.65秒止めると自動保存され、ページの再読み込みは行いません。ポートを変更する場合は `--port 4180` を付けます。終了はCtrl+Cです。

保存先は設定ファイルと同じディレクトリの `annotations.json` です。`annotationsFile` で別の相対パスを指定できます。KuraのコメントはMarkdownで表示します。Write / Previewタブで入力と表示を切り替えられます。

```text
schema.json        DBから取得した構造・コメント（編集しない）
annotations.json   人が入力したコメント
       ↓ マージ
index.html         コメントを反映した閲覧用HTML
```

保存すると `annotations.json` を更新し、出力先のHTMLも再生成します。KuraのコメントとDBコメントが両方ある場合は、Kuraのコメントの下に区切り線を入れ、DBコメントを元のテキストで表示します。入力欄を空にするとKuraのコメントを削除します。DBコメントは変更しません。DBから再取得してもKuraのコメントは保持されます。

見出し・箇条書き・リンク・コード・表を使えます。HTMLタグと画像の埋め込みは無効です。MarkdownレンダーもHTMLに同梱するため、外部通信は不要です。

DBを再取得せず、既存のJSONとコメントからHTMLだけ再生成する場合は次を使います。

```sh
./kura build --config kura.config.json
```

設定ファイルと `annotations.json` はGitで管理できます。対象が削除・名前変更されたコメントは保持し、編集画面で確認・削除できます。別の画面やファイルで先に更新された場合は保存を拒否し、再読み込みを促します。編集中に `schema.json` を再取得した場合は、編集サーバーを再起動してください。

編集サーバーは `127.0.0.1` だけで待ち受け、設定されたコメントファイルだけに保存します。通常のHTMLやGitLab Pagesには編集操作を表示しません。

コメントファイルの形式と例は [データ形式](docs/DATA_FORMAT.md) を参照してください。

## テストDBで取得から生成まで試す

PostgreSQL 17の実行ファイルがある環境では、次のコマンドで専用のテストDBを作成できます。

```sh
./kura demo
```

macOS / Apple SiliconのHomebrew環境では `/opt/homebrew/opt/postgresql@17/bin` を使います。別の場所にインストールしている場合は指定してください。

```sh
KURA_PG_BIN='/path/to/postgresql/bin' ./kura demo
```

専用の `.kura-test/` 内にDBを用意し、テーブル・ビュー・権限・マスターを投入します。既存のDBサービスを使わず、Unixソケットだけで接続します。自分で起動したテストサーバーは終了時に停止し、DBファイルは再実行用に残します。

取得と生成を2回実行してJSON・HTMLのバイト単位の一致を確認します。出力先は `dist/demo/` で、検証結果は `verification.json` に記録します。

## 再現性と取得範囲

取得はREAD ONLY・REPEATABLE READトランザクションで行います。JSONのキーとオブジェクトの順序を固定し、生成日時やOID、統計カウンターは出力に含めません。DB容量も既定では取得しません。

同じDBの構造・権限・取得対象データ、設定、生成ツールと依存ライブラリであれば、同じJSON・HTMLを生成します。DBの内容が変わる場合は結果も変わります。ブラウザーやフォントが異なる場合の描画の完全一致を保証するものではありません。

取得・HTML生成が失敗した場合は、既存のHTMLを置き換えません。対象外スキーマへの参照はJSONの `warnings` に記録します。参照先も表示したい場合は `schemas` に含めてください。

現時点では次の制約があります。

- 1回の取得は1つのデータベースを対象にします。
- PostgreSQL 17以外のサーバーバージョンは未検証です。
- 多数のテーブルでの描画性能と、ブラウザー間の見た目・書き出しの差は未検証です。現在のJSON読み込みには200テーブルの上限があります。
- DB・スキーマ自体のDBコメント取得は未実装です。テーブル・カラムのDBコメントを取得します。
- SET ROLE後の権限、列単位の権限、RLSポリシーの意味は評価しません。画面の権限表示は接続・参照の成功を保証しません。
- ビューの依存関係はカタログに記録された直接参照です。関数内の動的SQLなどは解析しません。
- ビューのNOT NULLはカタログ情報を使い、式からの推論はしません。マテリアライズドビューの最終REFRESH日時も取得しません。
- ER図のカーディナリティは現在、固定の描画記号です。UNIQUEやNULL可否からの厳密な推定は未実装です。

取得の詳細は [生成手順](docs/GENERATE.md)、JSONの構造は [データ形式](docs/DATA_FORMAT.md) を参照してください。

## GitHub Pages

[公開サンプル](https://hikagami0210.github.io/kura/) · [GitHubリポジトリ](https://github.com/hikagami0210/kura)

付属の `.github/workflows/pages.yml` は、mainへのpushでチェック・生成を行い、`dist/site/` のサンプルだけを公開します。Pull Requestではチェックと生成のみ実行します。Actionsの画面から手動で再公開することもできます。

別のリポジトリで使う場合は、Settings → Pages → Sourceを **GitHub Actions** に設定してください。実DBへの接続やAPIキーは不要です。

## GitLab Pages

付属の [.gitlab-ci.yml](.gitlab-ci.yml) は、サンプルHTMLを生成して `dist/site/` を公開するテンプレートです。チェックジョブは `npm run check` を実行します。公開ジョブは、デフォルトブランチに対してGitLabのWeb画面から実行したパイプラインで動きます。

実DBのドキュメントを公開する場合は、CIからDBへ接続できるようにし、接続情報をCI変数へ設定します。サンプル公開用の `dist/site/` にはHTML・JSON・ライセンス表記だけをコピーし、テストDBの出力は含めません。公開ジョブの `npm run build` を `./kura generate --config ...` に変更し、設定の `output` と `pages.publish` のディレクトリを揃えてください。

Pagesの閲覧範囲はGitLab側で設定します。公開ディレクトリ内のJSONも配信対象になる点に注意してください。Kuraには閲覧者向けのログイン機能はありません。

## 開発

実装はTypeScriptです。スクリプトはtsxで実行し、ブラウザー用コードはesbuildでJavaScriptへ変換してHTMLに同梱します。

| コマンド                                        | 用途                                                   |
| ----------------------------------------------- | ------------------------------------------------------ |
| `npm run check`                                 | lint・フォーマット・型チェック・表示処理とER構文の検証 |
| `npm run typecheck`                             | TypeScriptの型チェック                                 |
| `npm run lint`                                  | Oxlintで検証                                           |
| `npm run lint:fix`                              | 修正可能なlint違反を修正                               |
| `npm run fmt`                                   | Oxfmtでフォーマット                                    |
| `npm run fmt:check`                             | フォーマットの確認                                     |
| `npm run build`                                 | サンプルから単一HTMLを生成                             |
| `npm run generate -- --config kura.config.json` | 設定したDBから生成                                     |
| `npm run edit -- --config kura.config.json`     | ローカルのコメント編集サーバー                         |
| `npm run check:annotations`                     | コメントのマージ・保存API・編集UIの検証                |
| `npm run demo`                                  | 専用テストDBで取得・生成を検証                         |

GitLab CIでは `npm run check` を実行します。テストDBの検証はPostgreSQLを用意した環境で別途実行します。生成物・依存ライブラリ・テストDBファイルはlintとフォーマットの対象外です。

### ファイル構成

```text
src/schema.ts              取得・JSON・表示で共有する型
scripts/collect.ts         PostgreSQL情報の取得
scripts/sql/               カタログ取得用のSQL
scripts/generate.ts        DB取得からJSON・HTMLまでの生成
scripts/html.ts            TSの変換、データとライブラリの埋め込み
scripts/edit.ts            ローカルのコメント編集サーバー
scripts/rebuild.ts         DBへ接続せずHTMLを再生成
src/annotations.ts         コメントの型・検証・マージ
scripts/check.ts           表示処理・ER構文の検証
scripts/demo.ts            専用テストDBでの検証
viewer/index.html          HTML・CSSテンプレート
viewer/app.ts              画面、URL、ER操作、書き出し
viewer/mermaid-entry.ts     Mermaid・Panzoomの初期化
examples/schema.json       サンプルデータ
examples/test-db/           テストDBの定義と取得設定
docs/                      生成手順・データ形式・計画
```

サンプルデータを変更する場合は `examples/schema.json`、取得する情報を増やす場合は共通型と取得・表示処理を変更し、`npm run check` を実行してください。

取得・生成スクリプトはstrict設定です。ビューアーの型設定は `tsconfig.viewer.json` で管理しています。

同梱ライブラリのライセンス表記は [THIRD_PARTY.txt](docs/THIRD_PARTY.txt)、今後の検討事項は [実装計画](docs/PLAN.md) を参照してください。

## ライセンス

Kura本体は [MIT License](LICENSE) です。同梱ライブラリには各ライブラリのライセンスが適用されます。[THIRD_PARTY.txt](docs/THIRD_PARTY.txt) を参照してください。

変更内容は [CHANGELOG.md](CHANGELOG.md)、公開物の構成は [公開ガイド](docs/RELEASE.md) に記載しています。
