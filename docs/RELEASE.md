# 公開ガイド

Kura 0.1.0はプレビュー版です。リポジトリの公開と、生成したドキュメントの公開を分けて扱います。

## 公開用サンプル

`npm ci`、`npm run check`、`npm run build` の順に実行します。`npm run build` は実DBに接続せず、架空の `examples/schema.json` と公開用の `examples/annotations.json` を使います。

- `dist/index.html`：公開デモ。編集用API・トークンは含みません。
- `dist/schema.json`：架空のDB情報。
- `dist/THIRD_PARTY.txt`：同梱ライブラリのライセンス。
- `dist/LICENSE`：Kura本体のライセンス。

GitLab Pagesの設定はCIでサンプルを生成し、上記4ファイルだけをコピーした `dist/site/` を公開します。`dist/demo/` などのテスト出力は含めません。GitHub Pagesも同じ4ファイルを公開します。公開URLはREADMEを参照してください。

## ローカル編集用サンプル

`./kura edit --config examples/viewer.config.json` で編集します。コメントは `.local/annotations.json`、HTMLとJSONは `.local/viewer/` に保存します。`.local/` はGit管理・公開対象に含めません。

公開デモのコメントを変える場合は `examples/annotations.json` を明示的に編集します。ローカルでの試し書きは公開デモへ自動反映されません。

## 配布するソース

README、LICENSE、CHANGELOG、src、scripts、viewer、examples、設定・ロックファイル、docsを含めます。node_modules、dist、.local、.kura-test、接続情報はGitに含めません。

GitLab Pagesへ実DBのドキュメントを配置する場合、HTMLだけでなくJSONも閲覧できるようになります。公開するDB情報と閲覧範囲を選んでください。

## 未完了の公開確認

- 実ブラウザーでナビゲーション・コメント編集・全画面・画像書き出しを確認。
- 多数のテーブルで描画時間と操作感を確認。
- GitLab Pagesの実環境で公開と共有URLを確認。
- 上記の確認後に実画面のスクリーンショットをREADMEへ追加。
