# LinkMe 服务器一键安装 / 升级 / 卸载（Windows，PowerShell 5.1+，需管理员）
#
#   从解压后的安装包运行（管理员 PowerShell）：
#     powershell -ExecutionPolicy Bypass -File .\install.ps1
#   在线安装：
#     irm http://HOST:8251/downloads/server/install.ps1 | iex
#   在线安装并传参：
#     & ([scriptblock]::Create((irm http://HOST:8251/downloads/server/install.ps1))) -DataDir D:\LinkMe-data
#
# 参数：
#   -DataDir DIR      数据目录（无人值守时必填；交互时不填则从磁盘列表中选择）
#   -InstallDir DIR   程序目录（默认 C:\Program Files\LinkMe）
#   -ConfigDir DIR    配置目录（默认 C:\ProgramData\LinkMe）
#   -PublicHost HOST  公网地址（IP 或域名）
#   -Binary FILE      使用指定的 linkme-server.exe
#   -Yes              除数据目录外全部使用默认值
#   -Uninstall        卸载服务与程序，保留配置和数据
#   -NoService        不注册服务、不改防火墙，只打印启动命令（测试用）
#
# 环境变量：
#   LINKME_DOWNLOAD_BASE  在线下载地址（默认 http://www.yucg.cn:8251/downloads/server）
#   LINKME_ANSWERS        应答文件：每行回答一个问题（自动化测试用），空行表示默认值
param(
	[string]$DataDir = '',
	[string]$InstallDir = '',
	[string]$ConfigDir = '',
	[string]$PublicHost = '',
	[string]$Binary = '',
	[switch]$Yes,
	[switch]$Uninstall,
	[switch]$NoService
)

function Invoke-LinkMeInstaller {
	param($DataDir, $InstallDir, $ConfigDir, $PublicHost, $Binary, [bool]$Yes, [bool]$Uninstall, [bool]$NoService, $ScriptDir)

	$ErrorActionPreference = 'Stop'
	$ProgressPreference = 'SilentlyContinue'
	$ServiceName = 'LinkMe'
	$RelayMin = 20000
	$RelayMax = 20127
	$DownloadBase = $env:LINKME_DOWNLOAD_BASE
	if (-not $DownloadBase) { $DownloadBase = 'http://www.yucg.cn:8251/downloads/server' }
	$DownloadBase = $DownloadBase.TrimEnd('/')
	if (-not $InstallDir) { $InstallDir = Join-Path $env:ProgramFiles 'LinkMe' }
	if (-not $ConfigDir) { $ConfigDir = Join-Path $env:ProgramData 'LinkMe' }
	$InstallDir = $InstallDir.TrimEnd('\')
	$ConfigDir = $ConfigDir.TrimEnd('\')
	$Exe = Join-Path $InstallDir 'linkme-server.exe'
	$Config = Join-Path $ConfigDir 'config.json'
	# 与控制台约定一致：密钥类文件放 private\，控制台的配置备份放 config-backups\
	$SecretFile = Join-Path $ConfigDir 'private\media-secret'
	$StateFile = Join-Path $ConfigDir 'installer.json'
	$Utf8 = New-Object System.Text.UTF8Encoding($false)

	# ------------------------------------------------------------ 输出与输入
	function Say([string]$Text = '') { Write-Host $Text }
	function Info([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
	function Warn([string]$Text) { Write-Host "警告：$Text" -ForegroundColor Yellow }
	function Fail([string]$Text) { throw "错误：$Text" }

	$script:UseAnswers = $false
	$script:Answers = New-Object System.Collections.Queue
	if ($env:LINKME_ANSWERS) {
		if (-not (Test-Path -LiteralPath $env:LINKME_ANSWERS)) { Fail "无法读取应答文件 $($env:LINKME_ANSWERS)" }
		foreach ($line in [IO.File]::ReadAllLines($env:LINKME_ANSWERS, [Text.Encoding]::UTF8)) { $script:Answers.Enqueue($line) }
		$script:UseAnswers = $true
	}
	$HaveInput = $script:UseAnswers -or (-not [Console]::IsInputRedirected)

	function Read-Line([string]$Prompt, [switch]$Secret) {
		if ($script:UseAnswers) {
			if ($script:Answers.Count -eq 0) { Fail "输入已结束（$Prompt）" }
			$a = [string]$script:Answers.Dequeue()
			if ($Secret) { $shown = '********' } else { $shown = $a }
			if ($Secret -and -not $a) { $shown = '' }
			Write-Host "$($Prompt): $shown"
			return $a
		}
		if ($Secret) {
			$sec = Read-Host -Prompt $Prompt -AsSecureString
			$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
			try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
		}
		return (Read-Host -Prompt $Prompt)
	}

	function Ask([string]$Prompt, [string]$Default) {
		if ($Yes -or -not $HaveInput) { return $Default }
		if ($Default) { $p = "$Prompt [$Default]" } else { $p = $Prompt }
		$a = Read-Line $p
		if (-not $a) { return $Default }
		return $a.Trim()
	}

	function AskYesNo([string]$Prompt, [bool]$Default) {
		while ($true) {
			if ($Yes -or -not $HaveInput) { return $Default }
			if ($Default) { $p = "$Prompt [Y/n]" } else { $p = "$Prompt [y/N]" }
			$a = Read-Line $p
			if (-not $a) { return $Default }
			switch -Regex ($a.Trim()) {
				'^(y|yes|是)$' { return $true }
				'^(n|no|否)$' { return $false }
			}
			Say '请输入 y 或 n。'
		}
	}

	# ------------------------------------------------------------ 工具
	function New-RandomString([int]$Length) {
		$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'.ToCharArray()
		$bytes = New-Object byte[] ($Length * 2)
		$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
		$rng.GetBytes($bytes)
		$sb = New-Object System.Text.StringBuilder
		for ($i = 0; $i -lt $Length; $i++) {
			$v = [int]$bytes[2 * $i] * 256 + [int]$bytes[2 * $i + 1]
			[void]$sb.Append($chars[$v % $chars.Length])
		}
		return $sb.ToString()
	}

	function New-RandomHex([int]$Bytes) {
		$b = New-Object byte[] $Bytes
		(New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b)
		return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
	}

	function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, $Utf8) }

	function Get-Health([int]$Port) {
		try {
			$r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$Port/health"
			if ($r.Content -match '"ok"\s*:\s*true') { return $r.Content }
		} catch { }
		return $null
	}

	function Wait-Health([int]$Port, [int]$Seconds) {
		for ($i = 0; $i -lt $Seconds; $i++) {
			$h = Get-Health $Port
			if ($h) { return $h }
			Start-Sleep -Seconds 1
		}
		return $null
	}

	function Test-PortInUse([int]$Port) {
		try {
			return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
		} catch { return $false }
	}

	function Get-PrimaryIP {
		try {
			$cfg = Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1
			if ($cfg) { return [string]($cfg.IPv4Address | Select-Object -First 1).IPAddress }
		} catch { }
		try {
			$a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
			if ($a) { return [string]$a.IPAddress }
		} catch { }
		return ''
	}

	function Format-Size([double]$Bytes) {
		if ($Bytes -ge 1TB) { return ('{0:N1}T' -f ($Bytes / 1TB)) }
		if ($Bytes -ge 1GB) { return ('{0:N1}G' -f ($Bytes / 1GB)) }
		return ('{0:N0}M' -f ($Bytes / 1MB))
	}

	function Test-Admin {
		$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
		return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
	}

	# 只允许 Administrators 与 SYSTEM（非管理员测试时额外保留当前用户）
	function Set-PrivateAcl([string]$Path) {
		$grants = @('*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F')
		if (-not $IsAdmin) { $grants += ('*' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value + ':(OI)(CI)F') }
		$args2 = @($Path, '/inheritance:r', '/grant:r') + $grants + @('/C', '/Q')
		$out = & icacls.exe @args2 2>&1
		if ($LASTEXITCODE -ne 0) { Warn "设置权限失败：$Path`n$out" }
		# 已有的子项改为只继承上面的目录权限（重新安装沿用旧配置/数据时）
		foreach ($child in @(Get-ChildItem -LiteralPath $Path -Force)) {
			$out = & icacls.exe $child.FullName /reset /T /C /Q 2>&1
			if ($LASTEXITCODE -ne 0) { Warn "重置权限失败：$($child.FullName)`n$out" }
		}
	}

	function Invoke-Server([string]$Program, [string[]]$Arguments) {
		# PowerShell 5.1 把原生程序的 stderr 包装成错误记录；在 Stop 模式下会直接抛出
		$ErrorActionPreference = 'Continue'
		$out = & $Program @Arguments 2>&1 | ForEach-Object { "$_" } | Out-String
		return @{ Code = $LASTEXITCODE; Output = $out.Trim() }
	}

	function Get-ServerVersion([string]$Program) {
		try {
			$r = Invoke-Server $Program @('-version')
			if ($r.Code -eq 0 -and $r.Output) { return ($r.Output -split "`r?`n")[0].Trim() }
		} catch { }
		return ''
	}

	# ------------------------------------------------------------ 磁盘选择
	function Get-Disks {
		$list = @()
		try {
			$list = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction Stop | Where-Object { $_.Size -gt 1GB } |
				ForEach-Object { [pscustomobject]@{ Drive = $_.DeviceID; FileSystem = $_.FileSystem; Label = $_.VolumeName; Size = [double]$_.Size; Free = [double]$_.FreeSpace } })
		} catch { }
		if ($list.Count -eq 0) {
			$list = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null -and $_.Root -match '^[A-Z]:\\$' } |
				ForEach-Object { [pscustomobject]@{ Drive = $_.Name + ':'; FileSystem = ''; Label = $_.Description; Size = [double]($_.Used + $_.Free); Free = [double]$_.Free } })
		}
		return $list
	}

	function Select-DataDir {
		if ($DataDir) {
			Info "使用命令行指定的数据目录：$DataDir"
			return $DataDir
		}
		if (-not $HaveInput) { Fail '非交互运行时必须用 -DataDir 指定数据目录（数据盘必须由人工选择）。' }
		$disks = @(Get-Disks)
		Say ''
		Say '请选择用于存放 LinkMe 数据（数据库、文件、下载）的磁盘：'
		if ($disks.Count -eq 0) {
			Say '  （未检测到本地磁盘，请直接输入数据目录）'
			$d = ''
			while (-not $d) { $d = Read-Line '数据目录（完整路径）' }
			return $d
		}
		for ($i = 0; $i -lt $disks.Count; $i++) {
			$d = $disks[$i]
			Say ('  {0,2}) {1,-4} {2,-6} 总容量 {3,-8} 可用 {4,-8} {5}' -f ($i + 1), $d.Drive, $d.FileSystem, (Format-Size $d.Size), (Format-Size $d.Free), $d.Label)
		}
		while ($true) {
			$pick = Read-Line "请输入磁盘编号 (1-$($disks.Count))"
			$n = 0
			if ([int]::TryParse(([string]$pick).Trim(), [ref]$n) -and $n -ge 1 -and $n -le $disks.Count) { break }
			Say '请输入列表中的编号。'
		}
		$disk = $disks[$n - 1]
		if ($disk.Free -lt 5GB) { Warn "所选磁盘可用空间不足 5G（$(Format-Size $disk.Free)）。" }
		$def = "$($disk.Drive)\LinkMe-data"
		$dd = Read-Line "数据目录（回车确认，或输入新路径） [$def]"
		if (-not $dd) { $dd = $def }
		return $dd.Trim()
	}

	# ------------------------------------------------------------ 程序获取
	function Get-NewBinary {
		if ($Binary) {
			if (-not (Test-Path -LiteralPath $Binary)) { Fail "找不到程序：$Binary" }
			return (Resolve-Path -LiteralPath $Binary).Path
		}
		if ($ScriptDir -and (Test-Path -LiteralPath (Join-Path $ScriptDir 'linkme-server.exe'))) {
			$b = Join-Path $ScriptDir 'linkme-server.exe'
			Info "使用安装包内的程序：$b"
			return $b
		}
		try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
		$script:TmpDir = Join-Path ([IO.Path]::GetTempPath()) ('linkme-' + [guid]::NewGuid().ToString('N'))
		New-Item -ItemType Directory -Path $script:TmpDir | Out-Null
		$name = 'linkme-server-windows-amd64.zip'
		Info "下载 $DownloadBase/$name"
		try {
			Invoke-WebRequest -UseBasicParsing -Uri "$DownloadBase/SHA256SUMS.txt" -OutFile (Join-Path $script:TmpDir 'SHA256SUMS.txt')
			Invoke-WebRequest -UseBasicParsing -Uri "$DownloadBase/$name" -OutFile (Join-Path $script:TmpDir $name)
		} catch { Fail "下载失败：$($_.Exception.Message)" }
		$want = ''
		foreach ($line in Get-Content -LiteralPath (Join-Path $script:TmpDir 'SHA256SUMS.txt')) {
			$parts = $line -split '\s+', 2
			if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $name) { $want = $parts[0].ToLower() }
		}
		if (-not $want) { Fail "SHA256SUMS.txt 中没有 $name" }
		$got = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $script:TmpDir $name)).Hash.ToLower()
		if ($want -ne $got) { Fail "校验失败：$name（期望 $want，实际 $got）" }
		Info 'SHA256 校验通过'
		Expand-Archive -LiteralPath (Join-Path $script:TmpDir $name) -DestinationPath $script:TmpDir -Force
		$b = Join-Path $script:TmpDir 'linkme-server-windows-amd64\linkme-server.exe'
		if (-not (Test-Path -LiteralPath $b)) { Fail '安装包中缺少 linkme-server.exe' }
		return $b
	}

	# ------------------------------------------------------------ 状态与服务
	function Read-State {
		if (-not (Test-Path -LiteralPath $StateFile)) { return $null }
		try { $s = Get-Content -Raw -Encoding UTF8 -LiteralPath $StateFile | ConvertFrom-Json } catch { return $null }
		return $s
	}

	function Save-State($State) {
		Write-Utf8 $StateFile ($State | ConvertTo-Json)
	}

	function Stop-LinkMeService {
		$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
		if ($svc -and $svc.Status -ne 'Stopped') {
			Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
			try { $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) } catch { }
		}
		# 保证进程已退出，便于替换 exe
		for ($i = 0; $i -lt 20; $i++) {
			$p = Get-Process -Name 'linkme-server' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe }
			if (-not $p) { break }
			Start-Sleep -Milliseconds 500
		}
	}

	function Install-LinkMeService {
		$binPath = "`"$Exe`" -config `"$Config`""
		$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
		if ($existing) {
			Stop-LinkMeService
			& sc.exe delete $ServiceName | Out-Null
			Start-Sleep -Seconds 2
		}
		New-Service -Name $ServiceName -BinaryPathName $binPath -DisplayName 'LinkMe 服务器' -Description 'LinkMe 即时通讯服务器（由 LinkMe 安装程序注册）' -StartupType Automatic | Out-Null
		# 由服务管理器负责重启：控制台“重启”按钮以非零代码退出
		Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name Environment -Type MultiString -Value @('LINKME_SUPERVISED=1')
		& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/10000 | Out-Null
		if ($LASTEXITCODE -ne 0) { Warn 'sc.exe failure 设置失败' }
		& sc.exe failureflag $ServiceName 1 | Out-Null
		if ($LASTEXITCODE -ne 0) { Warn 'sc.exe failureflag 设置失败' }
	}

	function Get-FirewallRules($Ports, [bool]$Media) {
		$rules = @(@{ Name = 'LinkMe TCP'; Protocol = 'TCP'; Ports = @([string]$Ports.Api, [string]$Ports.Download, [string]$Ports.Console) })
		if ($Media) {
			$rules[0].Ports += [string]$Ports.Turn
			$rules += @{ Name = 'LinkMe UDP'; Protocol = 'UDP'; Ports = @([string]$Ports.Turn, "$RelayMin-$RelayMax") }
		}
		return $rules
	}

	function Open-Firewall($Ports, [bool]$Media) {
		Remove-NetFirewallRule -Group 'LinkMe' -ErrorAction SilentlyContinue
		foreach ($r in (Get-FirewallRules $Ports $Media)) {
			New-NetFirewallRule -DisplayName $r.Name -Group 'LinkMe' -Direction Inbound -Action Allow -Protocol $r.Protocol -LocalPort $r.Ports -Profile Any | Out-Null
			Info "已放行防火墙 $($r.Protocol) $($r.Ports -join ',')"
		}
	}

	function Run-Hint {
		return "`$env:LINKME_SUPERVISED='0'; & `"$Exe`" -config `"$Config`""
	}

	# ------------------------------------------------------------ 卸载
	function Do-Uninstall {
		$state = Read-State
		if (-not $state -and -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
			Fail "未找到由本安装程序创建的 LinkMe 安装（$StateFile）。"
		}
		Say "将卸载 LinkMe 服务与程序：$Exe"
		Say "配置（$ConfigDir）与数据会保留。"
		if (-not (AskYesNo '确认卸载？' $true)) { Fail '已取消' }
		$hasService = (-not $state) -or ([string]$state.ServiceKind -eq 'service')
		if ($hasService -and -not $NoService) {
			if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
				Stop-LinkMeService
				& sc.exe delete $ServiceName | Out-Null
			}
			Remove-NetFirewallRule -Group 'LinkMe' -ErrorAction SilentlyContinue
		}
		Remove-Item -LiteralPath $Exe -Force -ErrorAction SilentlyContinue
		Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
		$dataRoot = ''
		if ($state) { $dataRoot = $state.DataRoot }
		Say ''
		Say 'LinkMe 已卸载（服务、程序、防火墙规则已移除）。以下内容已保留，如不再需要请手工删除：'
		Say "  配置目录：  $ConfigDir（config.json、private\、config-backups\、server.log）"
		if ($dataRoot) { Say "  数据目录：  $dataRoot" }
		Say "  备份：      $(Join-Path $InstallDir 'backups')"
		Say '重新运行安装程序即可沿用原有配置与数据。'
	}

	# ------------------------------------------------------------ 升级
	function Do-Upgrade($State, [string]$NewBin, [string]$NewVersion) {
		$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath $Config | ConvertFrom-Json
		$dataDirPath = [string]$cfg.data_dir
		$apiPort = [int](([string]$cfg.listen) -replace '^.*:', '')
		$oldVersion = Get-ServerVersion $Exe
		$kind = [string]$State.ServiceKind
		Say ''
		Say "检测到已安装的 LinkMe（$InstallDir，版本 $(if ($oldVersion) { $oldVersion } else { '未知' })）。"
		Say "将升级到 $NewVersion。配置与数据不会被修改。"
		if (-not (AskYesNo '开始升级？' $true)) { Fail '已取消' }
		if ($kind -eq 'none' -and (Get-Health $apiPort)) { Fail "LinkMe 正在运行（端口 $apiPort），请先停止前台进程再升级。" }

		# 保留 .exe 扩展名，PowerShell 才会把它当作程序运行
		$staged = Join-Path $InstallDir 'linkme-server.new.exe'
		Copy-Item -LiteralPath $NewBin -Destination $staged -Force
		Info '用新程序检查现有配置'
		try { $r = Invoke-Server $staged @('-config', $Config, '-check-config') } catch { $r = @{ Code = 1; Output = $_.Exception.Message } }
		if ($r.Code -ne 0) {
			Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
			Say $r.Output
			Fail '新版本不接受当前配置，未做任何修改。'
		}

		if ($kind -eq 'service') { Info '停止服务'; Stop-LinkMeService }
		$backup = Join-Path $InstallDir ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
		New-Item -ItemType Directory -Force -Path (Join-Path $backup 'db') | Out-Null
		Copy-Item -LiteralPath $Exe -Destination (Join-Path $backup 'linkme-server.exe')
		$dbs = @(Get-ChildItem -LiteralPath $dataDirPath -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.db(-wal|-shm)?$' })
		foreach ($f in $dbs) { Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $backup 'db') }
		Info "已备份程序与 $($dbs.Count) 个数据库文件到 $backup"
		Move-Item -LiteralPath $staged -Destination $Exe -Force
		$State.Version = $NewVersion
		$State.InstalledAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

		if ($kind -ne 'service') {
			Save-State $State
			Say ''
			Say '升级完成（-NoService：未启动）。启动命令：'
			Say "  $(Run-Hint)"
			Say "备份：$backup"
			return
		}
		Info '启动服务并等待健康检查'
		Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
		$h = Wait-Health $apiPort 60
		if ($h) {
			Save-State $State
			Say ''
			Say "升级成功：$h"
			Say "备份：$backup"
			return
		}
		Warn "新版本健康检查失败，正在回滚到 $oldVersion"
		Stop-LinkMeService
		Copy-Item -LiteralPath (Join-Path $backup 'linkme-server.exe') -Destination $Exe -Force
		Get-ChildItem -LiteralPath $dataDirPath -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.db-(wal|shm)$' } | Remove-Item -Force
		Get-ChildItem -LiteralPath (Join-Path $backup 'db') -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dataDirPath -Force }
		Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
		if (Wait-Health $apiPort 60) { Fail "升级失败，已回滚到原版本并恢复数据库（备份保留在 $backup）。日志：$(Join-Path $env:ProgramData 'LinkMe\server.log')" }
		Fail "升级失败，回滚后服务仍未通过健康检查。备份在 $backup。日志：$(Join-Path $env:ProgramData 'LinkMe\server.log')"
	}

	# ------------------------------------------------------------ 全新安装
	function Ask-ConsoleAdmin {
		$u = ''
		while ($true) {
			$u = Ask '控制台管理员用户名' 'admin'
			if ($u -match '^[A-Za-z0-9._@-]+$') { break }
			Say '用户名只能包含字母、数字以及 . _ @ -'
			if ($Yes) { Fail '无效用户名' }
		}
		$pw = ''
		$generated = $false
		if (-not $Yes -and $HaveInput) {
			while ($true) {
				$pw = Read-Line '控制台管理员密码（至少 10 位，直接回车自动生成）' -Secret
				if (-not $pw) { break }
				if ($pw.Length -lt 10) { Say '密码至少 10 位。'; continue }
				$pw2 = Read-Line '再次输入密码' -Secret
				if ($pw2 -ceq $pw) { break }
				Say '两次输入不一致，请重新输入。'
			}
		}
		if (-not $pw) { $pw = New-RandomString 20; $generated = $true }
		return @{ User = $u; Password = $pw; Generated = $generated }
	}

	function Do-Install([string]$NewBin, [string]$NewVersion) {
		Say ''
		Say "LinkMe 服务器安装程序（windows-amd64，程序版本 $NewVersion）"
		Say '直接回车表示使用方括号中的默认值。'
		Say "程序目录：$InstallDir"
		Say "配置目录：$ConfigDir"

		$reuse = $false
		if (Test-Path -LiteralPath $Config) {
			Say "发现已有配置文件：$Config"
			$reuse = AskYesNo '沿用该配置（不会覆盖，也不会重新选择数据盘）？' $true
			if (-not $reuse) { Fail "为避免覆盖，请手工移走 $Config 后重试，或用 -ConfigDir 指定其他目录。" }
		}

		$admin = $null
		$ports = @{ Api = 8250; Download = 8251; Turn = 8252; Console = 8253 }
		if ($reuse) {
			$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath $Config | ConvertFrom-Json
			$dataRoot = Split-Path -Parent ([string]$cfg.data_dir)
			$ports.Api = [int](([string]$cfg.listen) -replace '^.*:', '')
			$ports.Download = [int](([string]$cfg.download_listen) -replace '^.*:', '')
			if ($cfg.console -and $cfg.console.listen) { $ports.Console = [int](([string]$cfg.console.listen) -replace '^.*:', '') }
			if ($cfg.media -and $cfg.media.listen) { $ports.Turn = [int](([string]$cfg.media.listen) -replace '^.*:', '') }
			$media = [bool]($cfg.media -and $cfg.media.enabled)
			$urlHost = ([string]$cfg.public_url) -replace '^[a-z]+://', '' -replace ':\d+$', ''
			if (AskYesNo '是否设置/重置控制台管理员密码？' $false) { $admin = Ask-ConsoleAdmin }
		} else {
			# 数据盘（必须由人选择）
			$dataRoot = (Select-DataDir).TrimEnd('\')
			if (-not [IO.Path]::IsPathRooted($dataRoot) -or $dataRoot -notmatch '^[A-Za-z]:\\.+' ) { Fail "数据目录必须是完整路径且不能是磁盘根目录：$dataRoot" }
			if ($dataRoot -match '["\r\n]') { Fail "数据目录不能包含引号或换行：$dataRoot" }
			if ((Test-Path -LiteralPath $dataRoot) -and (Get-ChildItem -LiteralPath $dataRoot -Force | Select-Object -First 1) -and -not (Test-Path -LiteralPath (Join-Path $dataRoot 'data'))) {
				Warn "数据目录 $dataRoot 已存在且不为空，LinkMe 会在其中创建 data\ 和 downloads\。"
			}

			# 公网地址
			$ip = Get-PrimaryIP
			if ($PublicHost) { $h = $PublicHost }
			elseif ($Yes -or -not $HaveInput) {
				if (-not $ip) { Fail '无法检测本机 IP，请用 -PublicHost 指定公网地址。' }
				$h = $ip
			} else {
				if ($ip) { Say "检测到本机 IP：$ip（若服务器在 NAT 之后，请输入公网 IP 或域名）" }
				$h = ''
				while (-not $h) { $h = Ask '公网地址（客户端用来连接的 IP 或域名）' $ip }
			}
			$h = ($h -replace '^[a-zA-Z]+://', '' -replace '/.*$', '').Trim('[', ']')
			if ($h -notmatch '^[A-Za-z0-9.:-]+$') { Fail "公网地址只能包含字母、数字、点、短横线：$h" }
			$bareHost = $h
			if ($h.Contains(':')) { $urlHost = "[$h]" } else { $urlHost = $h }

			# 端口
			if (-not (AskYesNo '使用默认端口（API 8250、下载页 8251、媒体中继 8252、控制台 8253）？' $true)) {
				foreach ($k in @(@('Api', 'API'), @('Download', '下载页'), @('Turn', '媒体中继 TURN'), @('Console', '控制台'))) {
					while ($true) {
						$v = Ask "$($k[1]) 端口" ([string]$ports[$k[0]])
						$n = 0
						if ([int]::TryParse($v, [ref]$n) -and $n -ge 1 -and $n -le 65535) { $ports[$k[0]] = $n; break }
						Say '端口必须是 1-65535 的数字。'
					}
				}
			}
			$media = AskYesNo '启用媒体中继（TURN，用于跨网络音视频通话和远程协助）？' $true
			$used = @($ports.Api, $ports.Download, $ports.Console)
			if ($media) { $used += $ports.Turn }
			if (@($used | Select-Object -Unique).Count -ne $used.Count) { Fail "端口不能重复：$($used -join ' ')" }
			foreach ($p in $used) {
				if ($media -and $p -ge $RelayMin -and $p -le $RelayMax) { Fail "端口 $p 与媒体中继端口范围 $RelayMin-$RelayMax 冲突" }
				if (Test-PortInUse $p) { Fail "端口 $p 已被其他程序占用，请更换端口或先停止占用它的程序。" }
			}
			$admin = Ask-ConsoleAdmin
		}

		$openFw = $false
		if ($NoService) { Say '-NoService 模式不注册服务、不修改防火墙。' }
		else { $openFw = AskYesNo '是否在 Windows 防火墙中放行 LinkMe 端口？' $true }

		Say ''
		Say '即将安装：'
		Say "  程序目录：  $InstallDir"
		Say "  配置文件：  $Config$(if ($reuse) { '（沿用）' })"
		Say "  数据目录：  $dataRoot"
		if (-not $reuse) {
			Say "  公网地址：  $bareHost"
			$mediaPorts = ''
			if ($media) { $mediaPorts = "，TURN $($ports.Turn)（TCP/UDP）+ UDP $RelayMin-$RelayMax" }
			Say "  端口：      API $($ports.Api)，下载页 $($ports.Download)，控制台 $($ports.Console)$mediaPorts"
			Say "  媒体中继：  $(if ($media) { '启用' } else { '不启用' })"
		}
		if ($admin) { Say "  控制台账号：$($admin.User)" }
		if ($NoService) { Say '  Windows 服务：不注册（-NoService）' } else { Say "  Windows 服务：$ServiceName（自动启动，LocalSystem）" }
		if (-not (AskYesNo '确认开始安装？' $true)) { Fail '已取消' }
		Say ''

		# 目录与程序
		New-Item -ItemType Directory -Force -Path $InstallDir, $ConfigDir | Out-Null
		Set-PrivateAcl $ConfigDir
		Copy-Item -LiteralPath $NewBin -Destination "$Exe.new" -Force
		Move-Item -LiteralPath "$Exe.new" -Destination $Exe -Force
		Info "程序已安装到 $Exe"
		New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot 'data'), (Join-Path $dataRoot 'downloads') | Out-Null
		Set-PrivateAcl $dataRoot

		if (-not $reuse) {
			New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SecretFile) | Out-Null
			if ($media -and -not (Test-Path -LiteralPath $SecretFile)) {
				Write-Utf8 $SecretFile (New-RandomHex 32)
				Info "已生成媒体中继密钥 $SecretFile"
			}
			$stun = @()
			if ($media) { $stun = @("stun:$($urlHost):$($ports.Turn)") }
			$cfg = [ordered]@{
				listen          = ":$($ports.Api)"
				download_listen = ":$($ports.Download)"
				data_dir        = (Join-Path $dataRoot 'data')
				downloads_dir   = (Join-Path $dataRoot 'downloads')
				public_url      = "http://$($urlHost):$($ports.Api)"
				download_url    = "http://$($urlHost):$($ports.Download)"
				storage         = [ordered]@{ primary_enabled = $true; root = ''; require_marker = $false; reserve_bytes = 268435456; concurrent_uploads = 4; volumes = @() }
				chat            = [ordered]@{ max_attachment_bytes = 0; persist_attachment_bytes = 52428800; offline_queue_bytes = 262144000; offline_queue_messages = 100; uploads_per_hour = 0; received_cache_messages = 5000; received_cache_bytes = 20971520; received_cache_days = 30; received_cache_conversations = 100 }
				drive           = [ordered]@{ quota_gb = 5; max_files = 10000; max_folders = 2000; max_folder_depth = 32 }
				spaces          = [ordered]@{ max_document_bytes = 2097152; max_documents = 10000 }
				directory       = [ordered]@{ all_users = $true }
				admin           = [ordered]@{ users = @() }
				registration    = [ordered]@{ enabled = $false }
				console         = [ordered]@{ enabled = $true; listen = ":$($ports.Console)" }
				email_auth      = [ordered]@{ enabled = $false; credentials_file = '' }
				ai              = [ordered]@{ enabled = $false; credentials_file = ''; model = 'gpt-6-luna'; reasoning_effort = 'xhigh'; context_messages = 80; context_characters = 60000; concurrent_requests = 4 }
				media           = [ordered]@{
					enabled = $media; listen = ":$($ports.Turn)"; public_address = $bareHost
					urls = @("turn:$($urlHost):$($ports.Turn)?transport=udp", "turn:$($urlHost):$($ports.Turn)?transport=tcp")
					secret_file = $SecretFile; realm = 'linkme'; credential_seconds = 21600; direct_timeout_ms = 15000
					relay_min_port = $RelayMin; relay_max_port = $RelayMax; max_allocations_per_user = 32; bytes_per_second = 4194304; allowed_peer_cidrs = @()
				}
				meetings        = [ordered]@{ max_participants = 8; duration_minutes = 120; stun_urls = $stun }
			}
			Write-Utf8 $Config ($cfg | ConvertTo-Json -Depth 6)
			Info "已写入配置 $Config"
		}

		Info '检查配置'
		$r = Invoke-Server $Exe @('-config', $Config, '-check-config')
		if ($r.Code -ne 0) { Say $r.Output; Fail "配置检查未通过：$Config" }

		if ($admin) {
			Info "创建控制台管理员 $($admin.User)"
			$pwFile = Join-Path $ConfigDir ('.console-password-' + [guid]::NewGuid().ToString('N'))
			try {
				Write-Utf8 $pwFile ($admin.Password + "`n")
				$r = Invoke-Server $Exe @('-config', $Config, '-console-admin', $admin.User, '-console-password-file', $pwFile)
			} finally { Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue }
			if ($r.Code -ne 0) { Say $r.Output; Fail '创建控制台管理员失败' }
		}

		$state = [ordered]@{ InstallDir = $InstallDir; ConfigDir = $ConfigDir; DataRoot = $dataRoot; ServiceKind = 'none'; ApiPort = $ports.Api; Version = $NewVersion; InstalledAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
		$healthy = $false
		if (-not $NoService) {
			if ($openFw) { Open-Firewall $ports $media }
			Info "注册并启动 Windows 服务 $ServiceName"
			Install-LinkMeService
			$state.ServiceKind = 'service'
			Save-State ([pscustomobject]$state)
			Start-Service -Name $ServiceName
			Info "等待健康检查 http://127.0.0.1:$($ports.Api)/health"
			if (-not (Wait-Health $ports.Api 60)) { Fail "服务已注册，但 60 秒内未通过健康检查。日志：$(Join-Path $env:ProgramData 'LinkMe\server.log')" }
			$healthy = $true
		} else {
			Save-State ([pscustomobject]$state)
		}

		# 摘要
		Say ''
		Say '================================================================'
		if ($healthy) { Say " LinkMe 服务器安装完成，运行正常（版本 $NewVersion）" } else { Say ' LinkMe 已安装（-NoService：服务未注册、未启动）' }
		Say '================================================================'
		Say "  API 地址：      http://$($urlHost):$($ports.Api)"
		Say "  下载页：        http://$($urlHost):$($ports.Download)"
		Say "  管理后台：      http://$($urlHost):$($ports.Download)/admin/   （下载页右上角“管理后台登录”）"
		Say "  后台独立端口：  http://$($urlHost):$($ports.Console)/"
		if ($admin) {
			Say "  控制台用户名：  $($admin.User)"
			Say "  控制台密码：    $($admin.Password)"
			if ($admin.Generated) { Say '                  （自动生成，只显示这一次，请立即妥善保存）' } else { Say '                  （只显示这一次）' }
		} else { Say '  控制台账号：    沿用原有账号（未修改）' }
		Say "  数据目录：      $dataRoot"
		Say "  配置文件：      $Config"
		Say "  程序目录：      $InstallDir"
		if ($healthy) {
			Say "  查看日志：      Get-Content -Wait '$(Join-Path $env:ProgramData 'LinkMe\server.log')'"
			Say "  服务管理：      Restart-Service $ServiceName / Stop-Service $ServiceName"
		} else {
			Say '  启动命令：'
			Say "    $(Run-Hint)"
			Say "  健康检查：      Invoke-RestMethod http://127.0.0.1:$($ports.Api)/health"
		}
		Say '  升级：再次运行本安装程序；卸载：加 -Uninstall（保留配置和数据）'
		if (-not $NoService -and -not $openFw) {
			$fwText = "TCP $($ports.Api),$($ports.Download),$($ports.Console)"
			if ($media) { $fwText += "，TCP/UDP $($ports.Turn)，UDP $RelayMin-$RelayMax" }
			Say "  防火墙/安全组：请确保放行 $fwText"
		}
		Say '================================================================'
	}

	# ------------------------------------------------------------ 主流程
	$IsAdmin = Test-Admin
	if (-not $IsAdmin) {
		if ($NoService) { Warn '当前不是管理员；-NoService 测试模式继续运行。' }
		else { Fail '请以管理员身份运行 PowerShell（右键“以管理员身份运行”）。' }
	}
	if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64' -and $env:PROCESSOR_ARCHITECTURE -ne 'ARM64') {
		Fail "不支持的 CPU 架构：$($env:PROCESSOR_ARCHITECTURE)"
	}

	$script:TmpDir = $null
	try {
		if ($Uninstall) { Do-Uninstall; return }
		$newBin = Get-NewBinary
		$newVersion = Get-ServerVersion $newBin
		if (-not $newVersion) { Fail "程序无法运行或版本过旧（不支持 -version）：$newBin" }
		$state = Read-State
		if ($state -and (Test-Path -LiteralPath $Exe) -and (Test-Path -LiteralPath $Config)) {
			Do-Upgrade $state $newBin $newVersion
		} else {
			Do-Install $newBin $newVersion
		}
	} finally {
		if ($script:TmpDir -and (Test-Path -LiteralPath $script:TmpDir)) { Remove-Item -LiteralPath $script:TmpDir -Recurse -Force -ErrorAction SilentlyContinue }
	}
}

$linkmeScriptDir = ''
if ($PSCommandPath) { $linkmeScriptDir = Split-Path -Parent $PSCommandPath }
try {
	Invoke-LinkMeInstaller -DataDir $DataDir -InstallDir $InstallDir -ConfigDir $ConfigDir -PublicHost $PublicHost -Binary $Binary -Yes:$Yes.IsPresent -Uninstall:$Uninstall.IsPresent -NoService:$NoService.IsPresent -ScriptDir $linkmeScriptDir
	$global:LASTEXITCODE = 0
} catch {
	Write-Host $_.Exception.Message -ForegroundColor Red
	$global:LASTEXITCODE = 1
	# 以 -File 运行时返回非零退出码；通过 iex 运行时不关闭当前窗口
	if ($PSCommandPath) { exit 1 }
}
