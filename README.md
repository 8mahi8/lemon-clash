# 🍋 LEMON CLASH

CCレモン型の同時読み合い × 10枚の使い切り特殊カード。学校iPad Safari・Google Sitesでの友達対戦を目標に開発中。

## 現在の状態（v0.1 / オフライン・ルール試作）

- ✅ HTML + JavaScript。スマホと横向きiPadに対応するタップUI
- ✅ HP5 / 初期エネルギー1 / エネルギー上限7
- ✅ チャージ(+1)、通常攻撃(1消費・1ダメージ)、通常防御(無料・成功時のエネルギー獲得なし)
- ✅ 全10種類のカードを各1枚所持、コストを払って使用後は使い切り
- ✅ 行動を秘密で選び、双方の確定後に同時解決
- ✅ BOT戦、1台で端末を交代する2人対戦
- ✅ Node標準テストランナーによるカード相性テスト
- ⬜ **2台間のオンライン対戦は未実装**
- ⬜ 学校iPad + Google Sites + Firebase 実環境での確認は未実施

## ブラウザで試す

GitHub Pages を Settings > Pages > Deploy from a branch > main / (root) で有効化した場合：
https://8mahi8.github.io/lemon-clash/

開発用ローカルHTTPサーバーを使う場合はリポジトリルートを配信してください。外部サービスやビルドツールは不要です。

## Google Sites用のHTML全文を作る

Node.jsがある環境で：

    node tools/build-embed.cjs

出力は dist/lemon-clash-embed.html。この**ファイルの内容全文**をGoogle Sitesの「埋め込む > 埋め込みコード」に貼ります。GitHub Pagesへのiframeリンク埋め込みとは別方式です。

GitHub Actions の **Lemon Clash checks** が成功した場合、同じHTMLはワークフローの lemon-clash-google-sites-html アーティファクトからも取得できます。現在の埋め込み版はオフライン試作版です。

## カード一覧

| コスト | カード | 効果 |
|---|---|---|
| 1 | フェイント | 相手が通常防御なら、支払後エネルギー+3 |
| 1 | エネルギー泥棒 | 相手のチャージを無効化し、支払後エネルギー+2 |
| 1 | 見切り | 特殊攻撃カードのダメージを無効化（通常攻撃には無効） |
| 2 | 貫通攻撃 | 通常防御を貫通して1ダメージ |
| 2 | カウンター | 通常攻撃・連撃・オールインを防いで1反射 |
| 2 | 封印 | コスト3以下の特殊カードを無効化 |
| 3 | 連撃 | 2ダメージ。通常防御で完全に防がれる |
| 3 | 粉砕 | 通常防御に2ダメージ、その他は1 |
| 4 | 終焉の一撃 | 2ダメージ。通常防御には1 |
| 4 | オールイン | 3ダメージ。通常防御で完全に防がれる |

各カードは効果が失敗・無効化されてもコストを払い、使用済みになります。攻撃同士では両方の攻撃が成立し、両者HPが0になれば引き分け。

実装詳細：src/rules.js。テスト：tests/rules.test.cjs。

## 開発ブランチでのオンライン隔離試作

- `online.html`: 6桁の部屋作成・参加、秘密コミット、SHA-256照合、勝敗同期の試作画面。
- `src/online-protocol.js`: 同時選択用のコミット・公開検証ロジック。
- `src/online-app.js`: 別プロジェクトFirebase匿名認証＋Realtime Database接続処理。
- `firebase/lemon-clash-lab.rules.json`: **専用テスト環境だけ**の権限ルール。
- `tests/online-protocol.test.cjs`: コミット改ざん検出等の単体テスト。
- `tests/online-emulator-webkit.cjs`: 2台WebKit＋ローカルFirebaseエミュレーターの統合試験。
- `dist/lemon-clash-online-lab-embed.html`: ビルド時生成のオンライン用Google Sites埋め込みHTML全文。

**重要：まだオンライン対戦は公開していない。** `src/firebase-config.js` はnullのままで、認証・通信が開始されない。専用Firebaseテストプロジェクトの準備とWebKit/エミュレーターでの実テストが必要。詳しい手順は `docs/ONLINE_1V1.md`。既存BRAWL・小国戦線のFirebase設定は流用しない。

## オンライン対戦の設計メモ（今後）

Firebase RTDBを使い、専用ルームでお互いの行動を秘密で確定し、**両者のコミット完了後に公開・検証**する方式を検討。

重要：クライアントが未公開行動を直接読み取れる設計にしない。アクション+ターン+十分長いランダムsaltをSHA-256でcommitし、双方のcommit後にrevealする（commit-reveal）。同時にRTDB Rules / Authでユーザー、部屋、ターン、書込権限を保護する。部屋番号のみは認証ではない。

BRAWLの本番Firebase設定・Rules・公開Google Sitesには触れず、別の試験環境でオンライン動作を検証する。

## 検証

    node --test tests/rules.test.cjs

GitHub Actionsが構文・ゲームルール・Google Sites HTML生成を検査。CI成功は学校iPad実機・本番Firebaseでの動作保証ではありません。
