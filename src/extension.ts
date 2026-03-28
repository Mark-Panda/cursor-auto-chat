import * as vscode from 'vscode';
import * as http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** 避免每次 curl 都弹窗 */
let lastMacAccessibilityNotifyAt = 0;
const MAC_ACCESSIBILITY_NOTIFY_COOLDOWN_MS = 120_000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** macOS 拒绝 System Events 模拟按键（常见 -1002 / 中文「不允许发送按键」） */
function isLikelyMacAccessibilityKeyError(message: string): boolean {
    const m = message.toLowerCase();
    return (
        message.includes('1002') ||
        message.includes('不允许发送按键') ||
        m.includes('not allowed to send keystrokes') ||
        m.includes('osascript') && m.includes('system events')
    );
}

function maybeNotifyMacAccessibilityHelp(stderrOrMessage: string): void {
    if (!isLikelyMacAccessibilityKeyError(stderrOrMessage)) {
        return;
    }
    const now = Date.now();
    if (now - lastMacAccessibilityNotifyAt < MAC_ACCESSIBILITY_NOTIFY_COOLDOWN_MS) {
        return;
    }
    lastMacAccessibilityNotifyAt = now;

    const openPrefs = '打开「辅助功能」设置';
    const msg =
        '合成粘贴需要权限：请在「系统设置 → 隐私与安全性 → 辅助功能」中勾选 **Cursor**（若有 **Cursor Helper (Plugin)** 也一并勾选），并完全退出 Cursor（Cmd+Q）后重新打开。若仍提示 osascript：请在「隐私与安全性 → 自动化」中允许 Cursor 控制「系统事件 (System Events)」。';

    void vscode.window.showWarningMessage(msg, openPrefs).then((choice) => {
        if (choice === openPrefs) {
            void vscode.env.openExternal(
                vscode.Uri.parse(
                    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
                )
            );
        }
    });
}

type UiTarget = 'composer' | 'chat';

/**
 * Cursor 主对话是 Composer。newAgentChat 通常以 Agent 模式新开；openComposer 可能沿用上次 Ask。
 */
const OPEN_COMPOSER_COMMANDS = [
    'composer.newAgentChat',
    'composer.openComposer',
    'composer.focusComposer',
];

const OPEN_CHAT_COMMANDS = [
    'workbench.action.chat.open',
    'workbench.action.chat.toggle',
    'cursor.action.chat.open',
    'cursor.action.openChatPanel',
    'aichat.newchataction',
];

const FOCUS_COMPOSER_COMMANDS = ['composer.focusComposer'];

const FOCUS_CHAT_INPUT_COMMANDS = ['workbench.action.chat.focusInput', 'chat.action.focus'];

/**
 * Composer 与 Chat 的提交命令不同，需都尝试（auto 模式下不知道最终落在哪）。
 */
const SUBMIT_COMMANDS = [
    'composer.submit',
    'composer.quickAgentSubmit',
    'workbench.action.chat.submit',
    'workbench.action.chat.submitWithoutDispatching',
    'workbench.action.chat.submitWithCodebase',
    'cursor.action.chat.submit',
];

async function tryOpenSequence(
    label: string,
    ui: UiTarget,
    cmds: string[],
    errors: string[]
): Promise<{ ui: UiTarget; command: string } | null> {
    for (const cmd of cmds) {
        try {
            await vscode.commands.executeCommand(cmd);
            return { ui, command: cmd };
        } catch (e) {
            errors.push(`${label} ${cmd}: ${errMessage(e)}`);
        }
    }
    return null;
}

async function openDialogOrThrow(
    preference: 'auto' | 'composer' | 'chat'
): Promise<{ ui: UiTarget; command: string }> {
    const errors: string[] = [];

    if (preference === 'chat') {
        const r = await tryOpenSequence('chat', 'chat', OPEN_CHAT_COMMANDS, errors);
        if (r) {
            return r;
        }
        throw new Error(`无法打开 Chat 面板：\n${errors.join('\n')}`);
    }

    if (preference === 'composer') {
        const r = await tryOpenSequence('composer', 'composer', OPEN_COMPOSER_COMMANDS, errors);
        if (r) {
            return r;
        }
        throw new Error(`无法打开 Composer：\n${errors.join('\n')}`);
    }

    const composerResult = await tryOpenSequence(
        'composer',
        'composer',
        OPEN_COMPOSER_COMMANDS,
        errors
    );
    if (composerResult) {
        return composerResult;
    }

    const chatResult = await tryOpenSequence('chat', 'chat', OPEN_CHAT_COMMANDS, errors);
    if (chatResult) {
        return chatResult;
    }

    throw new Error(`无法打开对话界面（已试 Composer 与 Chat）：\n${errors.join('\n')}`);
}

async function focusComposerInputDeep(): Promise<void> {
    for (let i = 0; i < 2; i++) {
        for (const cmd of FOCUS_COMPOSER_COMMANDS) {
            try {
                await vscode.commands.executeCommand(cmd);
            } catch {
                /* 忽略 */
            }
        }
        if (i === 0) {
            await delay(120);
        }
    }
}

async function focusChatInput(): Promise<void> {
    for (const cmd of FOCUS_CHAT_INPUT_COMMANDS) {
        try {
            await vscode.commands.executeCommand(cmd);
            return;
        } catch {
            /* 下一个 */
        }
    }
}

async function focusChatInputDeep(): Promise<void> {
    await focusChatInput();
    await delay(120);
    await focusChatInput();
}

async function focusForUi(ui: UiTarget): Promise<void> {
    if (ui === 'composer') {
        await focusComposerInputDeep();
    } else {
        await focusChatInputDeep();
    }
}

/**
 * 将统一聊天 / Composer 切到 Agent（避免停留在 Ask）。
 * 与 Cursor 内置一致：workbench.action.chat.toggleAgentMode + { mode: 'agent' }。
 */
async function preferAgentModeInComposer(): Promise<void> {
    for (let round = 0; round < 2; round++) {
        if (round > 0) {
            await focusComposerInputDeep();
            await delay(200);
        }
        try {
            await vscode.commands.executeCommand('workbench.action.chat.toggleAgentMode', {
                mode: 'agent',
            });
            await delay(180);
            return;
        } catch {
            /* 再聚焦后重试 */
        }
    }
    try {
        await vscode.commands.executeCommand('composer.cycleMode');
        await delay(120);
    } catch {
        /* 无此命令或当前上下文不支持 */
    }
}

async function submitOrHint(): Promise<{ ok: true; command: string } | { ok: false }> {
    for (const cmd of SUBMIT_COMMANDS) {
        try {
            await vscode.commands.executeCommand(cmd);
            return { ok: true, command: cmd };
        } catch {
            /* 下一个 */
        }
    }
    void vscode.window.showInformationMessage('内容已填充，请按下 Enter（或 Cmd/Ctrl+Enter，视设置而定）发送');
    return { ok: false };
}

/**
 * 尝试可能支持「带参打开/预填」的命令。
 * 切勿使用 workbench.action.chat.testOpenWithPrompt：其为内部测试命令，会忽略参数并写入固定英文文案。
 */
async function tryInjectPrompt(content: string): Promise<string | null> {
    const attempts: [string, unknown][] = [
        ['composer.startComposerPrompt', content],
        ['composer.startComposerPrompt', { text: content }],
        ['composer.startComposerPrompt2', content],
    ];
    for (const [cmd, arg] of attempts) {
        try {
            await vscode.commands.executeCommand(cmd, arg);
            return `${cmd}`;
        } catch {
            /* 下一组 */
        }
    }
    return null;
}

/**
 * Chat 侧栏若为标准编辑器：粘贴 / 键入。Composer 主输入为 Lexical，此路往往无效。
 */
async function fillViaEditorCommands(content: string): Promise<'paste' | 'type'> {
    const prev = await vscode.env.clipboard.readText();
    try {
        await vscode.env.clipboard.writeText(content);
        try {
            await vscode.commands.executeCommand('editor.action.clipboardPaste');
            return 'paste';
        } catch (ePaste) {
            try {
                await vscode.commands.executeCommand('type', { text: content });
                return 'type';
            } catch (eType) {
                throw new Error(
                    `无法写入输入框。paste: ${errMessage(ePaste)}；type: ${errMessage(eType)}`
                );
            }
        }
    } finally {
        await vscode.env.clipboard.writeText(prev);
    }
}

/**
 * 将 Cursor 置前并发送 Cmd+V（剪贴板需已含待粘贴文本）。
 * 分两步执行：先激活应用，再在 Node 侧等待窗口前置，比单段 AppleScript 更稳。
 */
async function macOsSyntheticPaste(): Promise<void> {
    await execFileAsync(
        'osascript',
        ['-e', 'tell application "Cursor" to activate'],
        { timeout: 15000 }
    );
    await delay(450);
    await execFileAsync(
        'osascript',
        [
            '-e',
            'tell application "System Events" to keystroke "v" using command down',
        ],
        { timeout: 15000 }
    );
}

type FillPromptOutcome = {
    method: string;
    /** 曾尝试 macOS 合成粘贴但失败时附带（便于 curl / 日志排查） */
    composerMacSyntheticPasteError?: string;
};

async function fillPromptForUi(
    ui: UiTarget,
    content: string,
    cfg: vscode.WorkspaceConfiguration
): Promise<FillPromptOutcome> {
    if (ui === 'composer') {
        let composerMacSyntheticPasteError: string | undefined;
        const useMacFallback =
            cfg.get<boolean>('fallbackMacOsPaste') ?? process.platform === 'darwin';
        if (useMacFallback && process.platform === 'darwin') {
            const prev = await vscode.env.clipboard.readText();
            try {
                await vscode.env.clipboard.writeText(content);
                await delay(120);
                try {
                    await macOsSyntheticPaste();
                    /* osascript 返回后，界面可能稍晚才读剪贴板；若立刻在 finally 里 writeText(prev)，会粘成旧内容 */
                    await delay(600);
                    return { method: 'macOsSyntheticPaste' };
                } catch (e) {
                    const em = errMessage(e);
                    composerMacSyntheticPasteError = em;
                    console.error('[cursor-auto-chat] macOsSyntheticPaste:', em);
                    maybeNotifyMacAccessibilityHelp(em);
                }
            } finally {
                await vscode.env.clipboard.writeText(prev);
            }
        }

        const injected = await tryInjectPrompt(content);
        if (injected) {
            await delay(200);
            return {
                method: `inject:${injected}`,
                ...(composerMacSyntheticPasteError
                    ? { composerMacSyntheticPasteError }
                    : {}),
            };
        }

        try {
            const m = await fillViaEditorCommands(content);
            return {
                method: m,
                ...(composerMacSyntheticPasteError
                    ? { composerMacSyntheticPasteError }
                    : {}),
            };
        } catch (e) {
            throw new Error(
                `${errMessage(e)}。Composer 使用 Lexical 输入框。若已开启合成粘贴，请按弹窗或说明在「辅助功能 / 自动化」中为 Cursor 授权并重启应用。`
            );
        }
    }

    const m = await fillViaEditorCommands(content);
    return { method: m };
}

function sendJson(res: http.ServerResponse, status: number, payload: object): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

export function activate(context: vscode.ExtensionContext): void {
    console.log('Cursor Auto Chat plugin is now active!');

    if (!vscode.workspace.workspaceFolders?.length) {
        console.warn(
            '[cursor-auto-chat] 未打开工作区文件夹；部分 Cursor 功能会报 NoWorkspaceUriError，与扩展 HTTP 服务无关。建议在「文件 → 打开文件夹」下使用。'
        );
    }

    const config = vscode.workspace.getConfiguration('cursorAutoChat');
    const port = config.get<number>('port') ?? 3777;

    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
            sendJson(res, 200, { ok: true, service: 'cursor-auto-chat' });
            return;
        }

        if (req.method === 'POST' && req.url === '/chat') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk.toString();
            });
            req.on('end', () => {
                void (async () => {
                    try {
                        let data: { content?: string };
                        try {
                            data = JSON.parse(body.trim()) as { content?: string };
                        } catch (e) {
                            sendJson(res, 400, {
                                success: false,
                                error: 'Invalid JSON',
                                detail: errMessage(e),
                            });
                            return;
                        }

                        const content = data.content;
                        if (content === undefined || content === '') {
                            sendJson(res, 400, {
                                success: false,
                                error: 'Missing or empty "content" field',
                            });
                            return;
                        }

                        const target =
                            config.get<string>('target') === 'composer' ||
                            config.get<string>('target') === 'chat'
                                ? (config.get<string>('target') as 'composer' | 'chat')
                                : 'auto';

                        const opened = await openDialogOrThrow(target);
                        await delay(opened.ui === 'composer' ? 600 : 750);
                        await focusForUi(opened.ui);
                        await delay(220);

                        const preferAgent = config.get<boolean>('preferAgentMode') ?? true;
                        if (opened.ui === 'composer' && preferAgent) {
                            await preferAgentModeInComposer();
                            await delay(120);
                        }

                        const fill = await fillPromptForUi(opened.ui, content, config);
                        await delay(200);
                        await focusForUi(opened.ui);
                        await delay(120);

                        const submitResult = await submitOrHint();

                        sendJson(res, 200, {
                            success: true,
                            message: 'Dialog opened and filled',
                            ui: opened.ui,
                            openCommand: opened.command,
                            preferAgentMode:
                                opened.ui === 'composer' && preferAgent ? true : false,
                            fillMethod: fill.method,
                            ...(fill.composerMacSyntheticPasteError
                                ? {
                                      composerMacSyntheticPasteError:
                                          fill.composerMacSyntheticPasteError,
                                      macPasteAccessibilityHint:
                                          '系统设置 → 隐私与安全性 → 辅助功能：勾选 Cursor（及 Cursor Helper (Plugin)）；仍报 osascript 时在同一页的「自动化」中允许 Cursor 控制 System Events。授权后请 Cmd+Q 退出 Cursor 再打开。',
                                  }
                                : {}),
                            submitted: submitResult.ok,
                            submitCommand: submitResult.ok ? submitResult.command : null,
                            submitFallback: !submitResult.ok,
                        });
                    } catch (e) {
                        const message = errMessage(e);
                        console.error('[cursor-auto-chat] /chat error:', message);
                        sendJson(res, 500, {
                            success: false,
                            error: message,
                        });
                    }
                })();
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
    });

    server.listen(port, () => {
        void vscode.window.showInformationMessage(
            `Cursor Auto Chat server running on port ${port}`
        );
    });

    context.subscriptions.push({
        dispose: () => {
            server.close();
        }
    });
}

export function deactivate(): void {}
