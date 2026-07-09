---
title: 使用 PowerDesigner 从 MySQL 反向工程生成物理数据模型并优化展示
published: 2026-05-19
pinned: false
description: 使用 PowerDesigner 从 MySQL 数据库反向生成物理数据模型（PDM），并批量替换中文注释、按模块分组、优化布局的完整流程。
cover: "https://media.yuxh.cc/blog/20260121150222.png"
coverInContent: true
tags: [数据库, PowerDesigner, MySQL]
category: 笔记
draft: false
---

把已有数据库结构反向导入 PowerDesigner 生成物理数据模型（PDM），再批量替换成中文名、按前缀自动分模块——这几步下来，模型就好读多了。

## 1. 新建 PDM 并连上数据库

新建一个 **Physical Data Model** 文件，然后点菜单 **Database → Configure Connections**，左边选 **Connection Profiles**：

![image](https://media.yuxh.cc/blog/20260121111127.png!inyaa)

## 2. 配 MySQL 连接

点左上角 **+** 新建 MySQL 连接：

![image](https://media.yuxh.cc/blog/20260124020439.png!inyaa)

填上主机、端口、用户名、密码和目标库名：

![image](https://media.yuxh.cc/blog/20260121111235.png!inyaa)

填完点 **Test Connection** 测通，没问题就保存。

## 3. 从数据库反向生成模型

点 **Database → Update Model from Database** 打开选项窗口。

操作顺序：先点右侧 **取消全选箭头**（→|）清空默认勾选，再点左侧 **选择数据库箭头**（|←）选目标库，最后点 **全选箭头**（→|）选中所有表：

![image](https://media.yuxh.cc/blog/20260121111509.png!inyaa)

![image](https://media.yuxh.cc/blog/20260121111620.png!inyaa)

按上面步骤操作后，点确定就导入到 PDM 了：

![image](https://media.yuxh.cc/blog/20260121111805.png!inyaa)

---

## 4. 批量把英文名替换成中文注释

PowerDesigner 默认显示英文名。如果数据库表字段已经写了中文 Comment，可以用脚本一次性替换过来。

路径：**Tools → Execute Commands → Edit/Run Script**

粘贴并运行以下脚本：

```vb
Option Explicit   
ValidationMode = True   
InteractiveMode = im_Batch  
  
Dim mdl ' 当前模型  
  
Set mdl = ActiveModel   
If (mdl Is Nothing) Then   
    MsgBox "当前没有打开的模型！"   
ElseIf Not mdl.IsKindOf(PdPDM.cls_Model) Then   
    MsgBox "当前模型不是物理数据模型（PDM）！"   
Else   
    ProcessFolder mdl   
End If  
  
Private Sub ProcessFolder(folder)   
    On Error Resume Next  
    Dim Tab   
    For Each Tab In folder.Tables   
        If Not Tab.IsShortcut Then   
            If Tab.Comment <> "" Then Tab.Name = Tab.Comment  
            Dim col   
            For Each col In Tab.Columns   
                If col.Comment <> "" Then col.Name = col.Comment   
            Next   
        End If   
    Next  

    Dim view   
    For Each view In folder.Views   
        If Not view.IsShortcut And view.Comment <> "" Then   
            view.Name = view.Comment   
        End If   
    Next  

    Dim f   
    For Each f In folder.Packages   
        If Not f.IsShortcut Then   
            ProcessFolder f   
        End If   
    Next   
End Sub
```

跑完之后，模型里的表名、字段名、视图名就都换成中文了。

## 5. 按前缀自动分组并创建模块图表

还能根据表名前缀（比如 `act_`、`sys_`）自动创建模块图表，把对应的表归进去。

路径一样：**Tools → Execute Commands → Edit/Run Script**，跑这个：

```vb
Option Explicit

Dim mdl, prefixMap, d, prefix, diagName
Dim tab, sym, symExists, diagram, tabCode
Dim createdCount, movedCount

Set mdl = ActiveModel

If mdl Is Nothing Then
    MsgBox "请在物理数据模型中运行此脚本！", vbExclamation
ElseIf mdl.ClassName <> "Physical Data Model" Then
    MsgBox "当前模型不是物理数据模型（PDM），请检查！", vbCritical
Else
    Set prefixMap = CreateObject("Scripting.Dictionary")
    prefixMap.Add "act_", "活动模块"
    prefixMap.Add "sys_", "系统模块"

    createdCount = 0
    movedCount = 0

    For Each prefix In prefixMap.Keys
        diagName = prefixMap(prefix)
        Set diagram = Nothing
        
        For Each d In mdl.PhysicalDiagrams
            If d.Name = diagName Then
                Set diagram = d
                Exit For
            End If
        Next
        
        If diagram Is Nothing Then
            Set diagram = mdl.PhysicalDiagrams.CreateNew()
            diagram.SetNameAndCode diagName, prefix & "diagram"
            createdCount = createdCount + 1
        End If

        For Each tab In mdl.Tables
            tabCode = LCase(tab.Code)
            If LCase(Left(tabCode, Len(prefix))) = LCase(prefix) Then
                symExists = False
                
                For Each sym In diagram.Symbols
                    If Not sym.Object Is Nothing Then
                        If sym.Object Is tab Then
                            symExists = True
                            Exit For
                        End If
                    End If
                Next
                
                If Not symExists Then
                    diagram.AttachObject(tab)
                    movedCount = movedCount + 1
                End If
            End If
        Next
        
        If Not diagram Is Nothing Then
            diagram.AutoLayout
        End If
    Next

    MsgBox "处理完成！" & vbCrLf & _
           "新创建模块图表：" & createdCount & " 个" & vbCrLf & _
           "新增表符号总数：" & movedCount & " 个", vbInformation
End If
```

其他模块也一样，在 `prefixMap.Add` 里加一行就行：

```vb
prefixMap.Add "user_", "用户模块"
prefixMap.Add "order_", "订单模块"
```

执行后 PowerDesigner 会自动创建对应的模块图表，把匹配前缀的表归进去并自动布局：

![image](https://media.yuxh.cc/blog/20260121112337.png!inyaa)

## 总结

跑完这五步，就能从 MySQL 反向生成 PDM、把英文名换成中文注释、按前缀自动分模块。接手上古系统或者做数据库文档标准化的时候特别好用，建议把脚本存下来，下个项目直接复用。
