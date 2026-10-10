# PostgreSQLからの生成

## 環境

Node.js 22.12以降と `npm ci`。通常の生成はPostgreSQLサーバーのインストール不要です。
検証済みのサーバーはPostgreSQL 17です。新旧バージョンへの対応は今後の検証対象です。

## 一つのコマンドで試す

```sh
./kura demo
```

macOS/Homebrewの `/opt/homebrew/opt/postgresql@17/bin` を使い、専用の `.kura-test/data` にDBを用意します。
別のインストール先なら `KURA_PG_BIN` を指定します。専用Unixソケットとポート55432を使い、TCPでは待ち受けません。
DBを作成し、テーブル・ビュー・マスター等を準備し、2回生成してバイト単位の一致を確認します。
自身で起動したサーバーは終了時に停止します。DBファイルは次の実行のために残します。
出力は `dist/demo/index.html`、`schema.json`、`verification.json` です。

## 自分のDBから生成

`examples/test-db/config.json` をコピーして変更します。
接続情報は設定ファイルに書かず、指定した環境変数に設定します。

```sh
export KURA_DATABASE_URL='postgresql://user:password@host:5432/database'
./kura generate --config kura.config.json
```

- `schemas`: 対象スキーマ。存在しないスキーマはエラー。
- `roles`: 表示するロール。省略時は `pg_` 以外のロール。
- `masters`: 対象のテーブル、取得するカラム、並び順、最大取得行数。
- `logicalRelations`: 人が設定した論理参照。自動推測はしない。
- `output`: 設定ファイルからの相対出力ディレクトリ。
- `environment`: 表示する環境名。
- `includeRuntimeInfo`: trueならDB容量も取得します。変動値のため完全一致の対象外になり得ます。

マスターの読み取り権限がない場合もエラーにし、古いHTMLを置き換えません。
対象外のスキーマへの参照は警告としてJSONに記録します。全体を追う場合は依存先のスキーマも指定してください。

## 再現性

取得はREAD ONLY・REPEATABLE READトランザクションで行います。
実行日時、DB容量、OID、統計カウンター等の変動しやすい値は標準出力に含めません。
オブジェクト順とJSONのキー順を固定します。LLMは呼びません。
同じDBの構造・権限・取得対象データ、設定、依存ライブラリであれば同じ結果を生成します。
マスターの並び順は指定カラムまたはPKを使い、同値の場合は取得した値のJSON表現で整列します。
PK/FKを取得し、複合FKは制約名・順序を持ったカラム組として保持します。
HTMLをメモリー内で完成させ、ファイルへの書き込み完了後に置き換えます。

## 現時点の範囲

- テーブル・通常ビュー・マテリアライズドビュー、カラム型・コメント・PK/FK。
- インデックス、部分条件、INCLUDE、定義SQL。
- ビューのSQLと、PostgreSQLの依存メタデータに記録された直接参照。
- ロール所属、CONNECT/USAGE/CREATE、テーブル・ビューの実効権限。
- スキーマ権限の付与経路（直接付与、PUBLIC、継承ロール、所有者、Superuser）。
- 明示指定のマスター値、論理参照。

SET ROLE後の権限、列権限、RLSポリシーの意味、関数内の動的SQLの依存関係は未評価です。
ビューの列のNULL可否はカタログの制約情報であり、式や参照先からの意味的な推論はしません。
DBデータが変化した場合やサーバーバージョンが変わった場合の完全一致は保証しません。
