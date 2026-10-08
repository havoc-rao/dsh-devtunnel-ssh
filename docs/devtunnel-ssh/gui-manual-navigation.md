# 当前GUI常规手工验收：mirror后导航（dlg-20261008-1ebcdc96，恢复b7ee22f2）

已确认现有源码modified/untracked保留，没有丢弃工作。用户确认新Tunnel同B、父侧做live验证，本会话不拨号、不访问个人GUI/profile。

只读核实底座client的DirPicker commitPath：POST mirror得到localMirror后调用该directoryFlow专有onPicked(localMirror)，这是被宿主传入picker的callback，不是settings.section可调用的通用workspace导航API。独立settings当前只收到HTTP返回，本轮不猜ctx.ui/workspaces私有选择方法。

最小修复：mirror成功消息明确“尚未切换当前会话”，展示返回的本地镜像路径，指引宿主侧栏添加/选择该localMirror，然后在其下打开会话/终端；不是one-click。返回缺路径/非绝对/控制字符报错，不假成功。client fixture7/7 PASS、新语法PASS。

## 可操作顺序（实际GUI步骤由用户执行）

1. Dev Tunnel SSH设置区先检查status实验支持；输入用户已确认的当前Tunnel/loopback端口、B用户和独立pin。新Tunnel ID用“新机器”，同目标换端口用更新；确认agent/前提。
2. 保存后再probe（未保存端点不能测），查看保存目标/端点及lastprobe；失败按分层提示，不关闭pin、不自动重试。用户对新端点已确认归属不等于本会话代测。
3. 填本次授权B远端目录和明确本地工作区，点击mirror绑定并确认；复制返回的localMirror路径。
4. 在宿主侧栏现有“添加/选择工作区”入口，人工添加该**本地mirror**路径，不是B远端绝对路径；选择其下会话。设置form不会自动改变现会话。
5. 在该工作区打开宿主终端入口（不是仅SSH外部Terminal）；检查状态与B身份，resize/Ctrl-C和关闭清理。使用remote文件树/agent rw_*核对B的实验文件，不让普通本地工具当远端shell。
6. delete/断开与端口轮换另行明确操作；若sidebar入口无法添加路径，报告实际UI问题，不能通过改registry/meta或隐式选全局机器绕过。

GUI导航/终端点击未agent实测；生产ready不提升。当前仅公开picker onPicked合同已核实，没有通用settings导航能力证明。此轮范围仅提示与测试，无其它扩展。
