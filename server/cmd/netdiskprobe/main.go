// Command netdiskprobe 是开发期诊断工具：直连真实 SMB / FTP 服务器，
// 验证账号登录、共享枚举、文件读写与跨账号可见性。
//
// 用法（凭据只走命令行参数，本文件不入库）：
//
//	go run ./cmd/netdiskprobe smb-shares <user> <pass>
//	go run ./cmd/netdiskprobe smb-ops    <user> <pass> <share>
//	go run ./cmd/netdiskprobe ftp-ops    <user> <pass>
//	go run ./cmd/netdiskprobe cross      <userA> <passA> <userB> <passB> <share>
package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/hirochachacha/go-smb2"

	"haiku-wiki/server/internal/netdisk"
)

const host = "192.168.2.20"

func main() {
	if len(os.Args) < 2 {
		fmt.Println("用法: netdiskprobe <smb-shares|smb-ops|ftp-ops|cross> ...")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var err error
	switch os.Args[1] {
	case "smb-shares":
		err = smbShares(os.Args[2], os.Args[3])
	case "smb-try":
		err = smbTry(os.Args[2], os.Args[3], os.Args[4:])
	case "smb-dom":
		err = smbDomain(os.Args[2], os.Args[3], os.Args[4], os.Args[5:])
	case "ftp-try":
		err = ftpTry(os.Args[2], os.Args[3], os.Args[4:])
	case "ftp-raw":
		err = ftpRaw(os.Args[2], os.Args[3])
	case "smb-ops":
		err = smbOps(ctx, os.Args[2], os.Args[3], os.Args[4])
	case "ftp-ops":
		err = ftpOps(ctx, os.Args[2], os.Args[3])
	case "cross":
		err = crossCheck(ctx, os.Args[2], os.Args[3], os.Args[4], os.Args[5], os.Args[6])
	default:
		fmt.Println("未知子命令:", os.Args[1])
		os.Exit(2)
	}
	if err != nil {
		fmt.Println("RESULT: FAIL -", err)
		os.Exit(1)
	}
	fmt.Println("RESULT: OK")
}

// ---------- SMB 共享枚举 ----------

func smbShares(user, pass string) error {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, "445"), 15*time.Second)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	u := user
	if u == "" {
		u = "Guest"
	}
	dialer := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: u, Password: pass}}
	session, err := dialer.Dial(conn)
	if err != nil {
		return fmt.Errorf("session setup (%s): %w", user, err)
	}
	defer session.Logoff()
	shares, err := session.ListSharenames()
	if err != nil {
		return fmt.Errorf("ListSharenames (%s): %w", user, err)
	}
	fmt.Printf("[%s] 可见共享: %v\n", user, shares)
	return nil
}

// ---------- SMB 文件操作全流程 ----------

// smbDomain 带域试挂载候选共享（AD / 域环境必须 DOMAIN\user）。
func smbDomain(user, pass, domain string, candidates []string) error {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, "445"), 15*time.Second)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	dialer := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: user, Password: pass, Domain: domain}}
	session, err := dialer.Dial(conn)
	if err != nil {
		return fmt.Errorf("session setup (%s@%s): %w", user, domain, err)
	}
	defer session.Logoff()
	ok := 0
	for _, name := range candidates {
		share, err := session.Mount(name)
		if err != nil {
			fmt.Printf("[%s@%s] share %-12s 挂载失败: %v\n", user, domain, name, err)
			continue
		}
		infos, lerr := share.ReadDir("")
		share.Umount()
		if lerr != nil {
			fmt.Printf("[%s@%s] share %-12s 挂载成功但列目录失败: %v\n", user, domain, name, lerr)
			continue
		}
		ok++
		fmt.Printf("[%s@%s] share %-12s 可用，根目录 %d 项:", user, domain, name, len(infos))
		for i, fi := range infos {
			if i >= 8 {
				fmt.Print(" …")
				break
			}
			fmt.Printf(" %s", fi.Name())
		}
		fmt.Println()
	}
	fmt.Printf("[%s@%s] 可用共享数: %d/%d\n", user, domain, ok, len(candidates))
	return nil
}

// ftpTry 登录后打印 PWD，并逐个尝试候选目录：切换 + 列目录 + 建目录权限测试。
func ftpTry(user, pass string, candidates []string) error {
	cfg := netdisk.Config{Kind: netdisk.KindFTP, Host: host, Port: 21, RootPath: "/", Mode: "passive", Encoding: "utf-8"}
	drv, err := netdisk.New(netdisk.KindFTP, cfg, &netdisk.Credentials{Username: user, Password: pass})
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer drv.Close()
	ctx := context.Background()
	items, err := drv.List(ctx, "/")
	if err != nil {
		return fmt.Errorf("list /: %w", err)
	}
	fmt.Printf("[%s] FTP 根目录 %d 项\n", user, len(items))
	for _, p := range candidates {
		list, lerr := drv.List(ctx, p)
		if lerr != nil {
			fmt.Printf("[%s] %-24s 列目录失败: %v\n", user, p, lerr)
			continue
		}
		fmt.Printf("[%s] %-24s 可进入，%d 项:", user, p, len(list))
		for i, it := range list {
			if i >= 8 {
				fmt.Print(" …")
				break
			}
			fmt.Printf(" %s", it.Name)
		}
		fmt.Println()
	}
	return nil
}

// smbTry 逐个尝试候选共享名：挂载成功并列一次根目录即视为可用。
func smbTry(user, pass string, candidates []string) error {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, "445"), 15*time.Second)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	u := user
	if u == "" {
		u = "Guest"
	}
	dialer := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: u, Password: pass}}
	session, err := dialer.Dial(conn)
	if err != nil {
		return fmt.Errorf("session setup (%s): %w", user, err)
	}
	defer session.Logoff()
	ok := 0
	for _, name := range candidates {
		share, err := session.Mount(name)
		if err != nil {
			fmt.Printf("[%s] share %-12s 挂载失败: %v\n", user, name, err)
			continue
		}
		infos, lerr := share.ReadDir("")
		share.Umount()
		if lerr != nil {
			fmt.Printf("[%s] share %-12s 挂载成功但列目录失败: %v\n", user, name, lerr)
			continue
		}
		ok++
		fmt.Printf("[%s] share %-12s 可用，根目录 %d 项:", user, name, len(infos))
		for i, fi := range infos {
			if i >= 8 {
				fmt.Print(" …")
				break
			}
			fmt.Printf(" %s", fi.Name())
		}
		fmt.Println()
	}
	fmt.Printf("[%s] 可用共享数: %d/%d\n", user, ok, len(candidates))
	return nil
}

func smbOps(ctx context.Context, user, pass, share string) error {
	cfg := netdisk.Config{Kind: netdisk.KindSMB, Host: host, Port: 445, Share: share, RootPath: "/"}
	drv, err := netdisk.New(netdisk.KindSMB, cfg, &netdisk.Credentials{Username: user, Password: pass})
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer drv.Close()
	return runOps(ctx, drv, fmt.Sprintf("smb/%s@%s/%s", user, host, share))
}

// ---------- FTP 文件操作全流程 ----------

func ftpOps(ctx context.Context, user, pass string) error {
	cfg := netdisk.Config{Kind: netdisk.KindFTP, Host: host, Port: 21, RootPath: "/", Mode: "passive", Encoding: "utf-8"}
	drv, err := netdisk.New(netdisk.KindFTP, cfg, &netdisk.Credentials{Username: user, Password: pass})
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer drv.Close()
	return runOps(ctx, drv, fmt.Sprintf("ftp/%s@%s", user, host))
}

// newLineReader 带超时的按行读取器（原始 FTP 对话用）。
func newLineReader(conn net.Conn) *bufio.Reader {
	br := bufio.NewReader(conn)
	_ = conn.SetReadDeadline(time.Now().Add(20 * time.Second))
	return br
}

// ftpRaw 原始 FTP 协议对话：SYST / FEAT / PWD / PASV+LIST / MKD，
// 直接看服务端回什么，绕过库的解析与错误映射。
func ftpRaw(user, pass string) error {
	addr := net.JoinHostPort(host, "21")
	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	br := bufio.NewReader(conn)
	readReply := func() (int, string) {
		for {
			line, err := br.ReadString('\n')
			if err != nil {
				fmt.Printf("S: <read err: %v>\n", err)
				return 0, ""
			}
			line = strings.TrimRight(line, "\r\n")
			if line == "" {
				continue
			}
			fmt.Printf("S: %s\n", line)
			if len(line) >= 4 && line[3] == ' ' {
				var code int
				fmt.Sscanf(line, "%d", &code)
				return code, line
			}
		}
	}
	cmd := func(format string, args ...any) (int, string) {
		s := fmt.Sprintf(format, args...)
		fmt.Printf("C: %s\n", s)
		if _, err := conn.Write([]byte(s + "\r\n")); err != nil {
			return 0, err.Error()
		}
		return readReply()
	}
	readReply()
	cmd("USER %s", user)
	cmd("PASS %s", pass)
	cmd("SYST")
	cmd("PWD")
	// PASV → 解析数据端口 → 建数据连接 → LIST → 读数据 → 读控制通道完成回复
	_, pasv := cmd("PASV")
	openData := func() net.Conn {
		i := strings.Index(pasv, "(")
		j := strings.Index(pasv, ")")
		if i < 0 || j < 0 {
			return nil
		}
		var a, b, c, d, p1, p2 int
		fmt.Sscanf(pasv[i+1:j], "%d,%d,%d,%d,%d,%d", &a, &b, &c, &d, &p1, &p2)
		dc, derr := net.DialTimeout("tcp", fmt.Sprintf("%d.%d.%d.%d:%d", a, b, c, d, p1<<8|p2), 10*time.Second)
		if derr != nil {
			fmt.Printf("data dial err: %v\n", derr)
			return nil
		}
		return dc
	}
	dc := openData()
	if dc != nil {
		defer dc.Close()
		cmd("LIST")
		data, _ := readAll(dc)
		fmt.Printf("--- LIST 数据（%d 字节）---\n%s--- END ---\n", len(data), string(data))
		readReply() // 150 的完成回复 226
	}
	cmd("MKD probe-dir")
	cmd("RMD probe-dir")
	cmd("QUIT")
	return nil
}

// readAll 读数据连接直到 EOF。
func readAll(conn net.Conn) ([]byte, error) {
	var out []byte
	buf := make([]byte, 32*1024)
	for {
		n, err := conn.Read(buf)
		out = append(out, buf[:n]...)
		if err != nil {
			if err.Error() == "EOF" {
				return out, nil
			}
			return out, nil
		}
	}
}

// runOps 对任意驱动跑一遍：列目录 → 建目录 → 写文件 → 读回 → Stat → 改名 → 移动 → 删除。
func runOps(ctx context.Context, drv netdisk.Driver, tag string) error {
	items, err := drv.List(ctx, "/")
	if err != nil {
		return fmt.Errorf("[%s] list /: %w", tag, err)
	}
	fmt.Printf("[%s] 根目录 %d 项:", tag, len(items))
	for _, it := range items {
		fmt.Printf(" %s(dir=%v,%dB)", it.Name, it.IsDir, it.Size)
	}
	fmt.Println()

	stamp := time.Now().Format("150405")
	dir := "/hk-probe-" + stamp
	file := dir + "/hello.txt"

	if err := drv.Mkdir(ctx, dir); err != nil {
		return fmt.Errorf("[%s] mkdir %s: %w", tag, dir, err)
	}
	if err := drv.Write(ctx, file, strings.NewReader("hello from "+tag), -1); err != nil {
		return fmt.Errorf("[%s] write %s: %w", tag, file, err)
	}
	rc, err := drv.Open(ctx, file)
	if err != nil {
		return fmt.Errorf("[%s] open %s: %w", tag, file, err)
	}
	buf := make([]byte, 64)
	n, _ := rc.Read(buf)
	rc.Close()
	if !strings.Contains(string(buf[:n]), tag) {
		return fmt.Errorf("[%s] read back mismatch: %q", tag, string(buf[:n]))
	}
	st, err := drv.Stat(ctx, file)
	if err != nil || st == nil || st.Size == 0 {
		return fmt.Errorf("[%s] stat %s: err=%v st=%+v", tag, file, err, st)
	}
	if err := drv.Rename(ctx, dir, "hk-probe-"+stamp+"-r"); err != nil {
		return fmt.Errorf("[%s] rename %s: %w", tag, dir, err)
	}
	dir = "/hk-probe-" + stamp + "-r"
	if err := drv.Move(ctx, dir, "/"); err == nil {
		// Move 到根 = 原地不动，驱动允许；继续
		_ = dir
	}
	// 改名文件再删目录（递归）
	if err := drv.Rename(ctx, file, dir+"/renamed.txt"); err != nil {
		return fmt.Errorf("[%s] rename file: %w", tag, err)
	}
	if err := drv.Remove(ctx, dir, true); err != nil {
		return fmt.Errorf("[%s] remove %s: %w", tag, dir, err)
	}
	fmt.Printf("[%s] CRUD 全流程通过（已清理 %s）\n", tag, dir)
	return nil
}

// ---------- 跨账号可见性 ----------

func crossCheck(ctx context.Context, userA, passA, userB, passB, share string) error {
	stamp := time.Now().Format("150405")
	marker := "/hk-cross-" + stamp

	cfgA := netdisk.Config{Kind: netdisk.KindSMB, Host: host, Port: 445, Share: share, RootPath: "/"}
	drvA, err := netdisk.New(netdisk.KindSMB, cfgA, &netdisk.Credentials{Username: userA, Password: passA})
	if err != nil {
		return fmt.Errorf("connect A: %w", err)
	}
	defer drvA.Close()
	cfgB := netdisk.Config{Kind: netdisk.KindSMB, Host: host, Port: 445, Share: share, RootPath: "/"}
	drvB, err := netdisk.New(netdisk.KindSMB, cfgB, &netdisk.Credentials{Username: userB, Password: passB})
	if err != nil {
		return fmt.Errorf("connect B: %w", err)
	}
	defer drvB.Close()

	if err := drvA.Mkdir(ctx, marker); err != nil {
		return fmt.Errorf("A mkdir %s: %w", marker, err)
	}
	defer drvA.Remove(ctx, marker, true) // 清理（B 可能看得见，由 A 负责删）

	items, err := drvB.List(ctx, "/")
	if err != nil {
		return fmt.Errorf("B list /: %w", err)
	}
	visible := false
	for _, it := range items {
		if it.Name == strings.TrimPrefix(marker, "/") {
			visible = true
		}
	}
	fmt.Printf("cross-check: A(%s) 创建 %s 后，B(%s) 在共享 %s 根目录可见=%v（B 共看到 %d 项）\n",
		userA, marker, userB, share, visible, len(items))
	return nil
}
