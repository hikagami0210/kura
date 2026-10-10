# JSON形式（試作 v1）

実例は `examples/schema.json`。正式版ではJSON Schemaによる検証を追加します。

- `formatVersion`: 形式バージョン。
- `environment`, `capturedAt`: 取得元環境と日時。
- `databases[]`: `name`, `info`, `schemas[]`, `access[]`。
- `schemas[]`: `name`, `tables[]`。テーブル名はスキーマ内で一意。
- `tables[]`: `name`, `description`, `columns[]`, `relations[]`, 任意の `master`, `notes[]`。
- `relations[]`: `column`, `table`, `target`, 任意の `schema`, `database`。
  `kind: logical` は制約未定義の関係。`confirmed`, `source`, `description` を保持する。
- `master`: `columns`, `rows`, `complete`。抜粋を全件と混同しない。
- `notes[]`: `key`, `text`, `source`, `confirmed`。最初のマスターカラムをキーとして参照する試作仕様。
- `roles[]`: クラスタ共通のロール。`name`, `login`, `superuser`, `inherit`, `memberships`。
- `access[]`: DB内の対象について `role`, `schema`, `table`, `connect`, `usage`, `select`, `insert`, `update`, `delete`, `via`, `rls`。
  権限はtrue/false、未取得は省略する。経路とRLSは試作では説明文字列。

単一DBの旧 `name`, `tables[]` 形式は `public` スキーマとして読み込みます。
DBの認証情報、パスワード、接続文字列は入れません。

現在は同じDB内のスキーマ間関係を中心に対応しています。DB間の論理関係の表示や複合キーの正式表現は今後拡張します。

## ビュー

既存の `tables[]` を共通オブジェクト配列として再利用します。
`kind` は `table`（省略時）、`view`、`materialized_view`。
ビューには `definition`（SQL）、`dependencies[]`（参照先の `name`, `schema`, 任意の `database`）を追加します。
マテリアライズドビューには `populated` と `indexes[]` を保持します。
依存先をJSONに含めることを前提とし、依存関係は外部キーと別に扱います。
実DBからの収集に対応しています。定義はpg_get_viewdef、依存関係はpg_depend/pg_rewrite、格納状態はpg_class.relispopulatedから取得します。
最終REFRESH日時は推測しません。

## 追加した説明

取得したJSONとは別の `annotations.json` をHTML生成時にマージします。

```json
{
  "formatVersion": 1,
  "entries": [
    {
      "target": { "kind": "database", "database": "commerce" },
      "description": "受注管理のデータベース"
    },
    {
      "target": { "kind": "schema", "database": "commerce", "schema": "public" },
      "description": "業務データを管理するスキーマ"
    },
    {
      "target": { "kind": "table", "database": "commerce", "schema": "public", "table": "orders" },
      "description": "注文の受付と現在の状態を保持する"
    },
    {
      "target": {
        "kind": "column",
        "database": "commerce",
        "schema": "public",
        "table": "orders",
        "column": "id"
      },
      "description": "注文を一意に識別するID"
    }
  ]
}
```

対象の識別にDB名・スキーマ名・テーブル名・カラム名を使います。テーブル名はスキーマ内の名前で、ビューも `kind: table` で指定します。同一対象の重複はエラーです。

表示ではKuraの説明を上、DBコメントを区切り線の下に置きます。空文字はKuraの説明の空値、エントリーの削除は追加説明の解除です。生成HTML用データは元のコメントをdbComment、追加説明をkuraDescriptionとして保持します。取得したschema.jsonは変更しません。対応先のないエントリーは保持し、生成時の警告と編集画面で知らせます。

説明ファイルが存在しない場合は空として扱います。不正なJSONや形式の場合は生成・保存を中止します。
