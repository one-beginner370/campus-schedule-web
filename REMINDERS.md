# 明日课程系统提醒

原网站： https://one-beginner370.github.io/campus-schedule-web/

## 当前发布状态

前端和后台代码已加入本仓库。`dist/push-config.json` 中 `backendUrl` 为 null 时，表示后台服务尚未连接；前端会禁止启用并明确提示，不会宣称已经开启提醒。只有完成下述后台部署、验证定时任务并更新此配置后，系统提醒才具备运行条件。每台手机还需要自己允许系统通知并完成推送订阅。

## 服务结构

GitHub Pages 保留原网址。Supabase Edge Function 处理设备订阅与标准 Web Push；Postgres 私有表保存每台设备的提醒副本和投递状态；Supabase Cron 在 UTC 11:30（北京时间 19:30）首次触发，11:31–11:39 仅处理失败或未完成的发送。没有明日课程的设备不会收到日常通知。后台运行不依赖网页、电脑或 Codex 保持打开。

课程按照学校第一周的周一计算教学周，支持单双周和单独周次。提醒列出第二天的课程、开始/结束时间和教室。内容过多时保留前几项并提示点击查看；点击通知会打开 `?reminderDate=YYYY-MM-DD#today`，查看对应日期而非当前日期。

## 部署

1. 在已授权的 Supabase 账号中选择此项目专用的数据库项目；不要修改无关项目。
2. 设置部署进程的 `SUPABASE_ACCESS_TOKEN` 和 `SUPABASE_PROJECT_REF`。凭据不得写入 Git、网页、命令参数、日志或聊天。
3. 安装锁定依赖后运行 `node scripts/deploy-reminders.mjs`。脚本会部署数据库结构、函数、密钥和 Vault 定时任务，保留已存在的 VAPID 密钥，并验证服务和任务。它不会创建收费项目或自动更改计费方案。
4. 将脚本成功生成的 `dist/push-config.json` 提交至原仓库，让原 GitHub Pages 工作流更新网站。
5. 手机上打开课表设置，设置学校第一周日期后点击“启用系统提醒”，允许系统通知，再用“发送测试通知”确认实际设备接收。

如通过 Supabase 插件部署：应用 `supabase/migrations/202610100001_reminders.sql`，将 `_shared` 三个模块和 `campus-reminders/index.ts` 一同部署（关闭网关 JWT 验证，接口自身使用设备密钥/后台密钥认证），设置 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`CRON_SECRET`；在 Vault 创建 `campus_reminder_endpoint` 和 `campus_reminder_cron_secret` 后应用 `supabase/install-cron.sql`。所有密钥均只保存在服务端。

## 手机要求与数据

- iPhone 需要 iOS 16.4 或更新版本，将原网站添加到主屏幕并从主屏幕打开，才能申请通知权限。
- 安卓需要支持标准 Web Push 的浏览器、系统通知权限，以及浏览器推送通道可达。通知实际送达还受网络、省电、勿扰模式影响，不能保证系统每次都在整秒显示。
- 启用时只同步课程名称、周次、星期、节次、作息、教室和推送订阅，不上传 PDF、截图、教师或聊天附件。设备通过独立随机密钥访问自己的副本；数据库开启 RLS，匿名用户不能读取/写入数据表或调用发送任务。
- 修改课表后自动同步；离线修改会显示未同步状态，联网重新打开网站后重试。关闭提醒会撤销设备订阅并请求删除云端副本。离线关闭时先撤销设备推送，云端清理失败会明确提示。

## 验证范围

`node --test tests/*.test.mjs` 验证时区、教学周、单双周、跨年、没课跳过、负载长度、真实 Web Push 加密解密、设备授权、定时任务鉴权、重试、过期订阅、取消订阅及 Postgres RLS/原子领取/版本控制。`node tests/browser.mjs` 使用已安装的 Edge 验证设置界面、权限流程（模拟）、自动同步、取消同步竞态、通知目标日期及页面关闭后的 Service Worker 推送事件（模拟）。后台未连接时，以上不代表云端定时任务或手机真实送达已通过。

参考：[Supabase 定时函数](https://supabase.com/docs/guides/functions/schedule-functions)、[WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)、[Web Push 库](https://github.com/web-push-libs/web-push)。
