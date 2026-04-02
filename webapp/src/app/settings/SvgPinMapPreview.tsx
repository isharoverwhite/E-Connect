import { BOARD_PROFILES, getBoardProfile, resolveBoardProfileId, type BoardPin } from "@/features/diy/board-profiles";
import { type PinMapping, PIN_FILL } from "@/features/diy/types";

export function SvgPinMapPreview({ boardId, pins }: { boardId: string, pins: PinMapping[] }) {
    const defaultBoard = BOARD_PROFILES[0];
    const resolvedBoardId = resolveBoardProfileId(boardId) ?? boardId;
    const board = getBoardProfile(resolvedBoardId) || defaultBoard;

    const totalRows = Math.max(board.leftPins.length, board.rightPins.length);
    const boardHeight = Math.max(420, totalRows * 34 + 120);
    const svgHeight = boardHeight + 120;
    const gap = totalRows === 1 ? 0 : (boardHeight - 70 - 110) / (totalRows - 1);

    function renderSvgPin({
        pin,
        index,
        side,
        assignment,
    }: {
        pin: BoardPin;
        index: number;
        side: "left" | "right";
        assignment?: PinMapping;
    }) {
        const top = 110;
        const y = top + gap * index;
        const isReserved = pin.capabilities.length === 0;
        const fill = assignment
            ? PIN_FILL.assigned
            : isReserved
                ? PIN_FILL.reserved
                : PIN_FILL.idle;

        const stemStart = side === "left" ? 188 : 532;
        const stemEnd = side === "left" ? 154 : 566;
        const pinX = side === "left" ? 130 : 566;
        const labelX = side === "left" ? 112 : 608;
        const mappingTextX = side === "left" ? 94 : 626;
        const anchor = side === "left" ? "end" : "start";

        return (
            <g key={pin.id}>
                <line x1={stemStart} x2={stemEnd} y1={y} y2={y} stroke="#475569" strokeWidth="3" />
                <rect
                    x={pinX}
                    y={y - 11}
                    width="28"
                    height="22"
                    rx="6"
                    fill={fill}
                    stroke="transparent"
                    strokeWidth="3"
                />
                <text
                    x={labelX}
                    y={y + 5}
                    fill={assignment ? "#f8fafc" : "#cbd5e1"}
                    textAnchor={anchor}
                    fontSize="14"
                    fontWeight="700"
                >
                    {pin.label}
                </text>
                <text
                    x={mappingTextX}
                    y={y + 24}
                    fill={assignment ? "#93c5fd" : "#64748b"}
                    textAnchor={anchor}
                    fontSize="11"
                    fontFamily="monospace"
                >
                    {assignment ? `${assignment.mode} · ${assignment.label || `GPIO ${pin.gpio}`}` : `GPIO ${pin.gpio}`}
                </text>
            </g>
        );
    }

    return (
        <div className="relative w-full rounded-lg flex items-center justify-center overflow-hidden group bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_45%),linear-gradient(180deg,#0b1120_0%,#111827_100%)] p-6 shadow-inner border border-slate-800">
            <svg
                viewBox={`0 0 720 ${svgHeight}`}
                className="w-full"
                role="img"
                aria-label={`${board.name} SVG GPIO mapping`}
            >
                <defs>
                    <linearGradient id="boardShell" x1="0%" x2="100%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor="#1e293b" />
                        <stop offset="100%" stopColor="#0f172a" />
                    </linearGradient>
                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>

                {board.id === 'esp32-c3-super-mini' ? (
                    <g id="super-mini-artwork" transform="translate(190, 50)">
                        <rect x="0" y="0" width="340" height={boardHeight} rx="12" fill="#151515" stroke="#333333" strokeWidth="4" />
                        <path d="M 130 -10 L 210 -10 L 210 0 L 130 0 Z" fill="#a0a0a0" stroke="#666" strokeWidth="2" />
                        <path d="M 140 -20 L 200 -20 L 200 -10 L 140 -10 Z" fill="#111" />
                        <path d="M 120 20 L 220 20 M 120 30 L 250 30 M 120 40 L 220 40" stroke="#bda25c" strokeWidth="4" fill="none" />
                        <rect x="80" y="60" width="16" height="24" fill="#333" rx="2" />
                        <rect x="244" y="60" width="16" height="24" fill="#333" rx="2" />
                        <text x="170" y="120" fill="#666" fontSize="14" fontFamily="monospace" textAnchor="middle">V1601</text>
                        <rect x="110" y="140" width="120" height="24" fill="#fff" rx="2" />
                        <text x="170" y="157" fill="#000" fontSize="16" fontWeight="bold" fontFamily="monospace" textAnchor="middle">ESP32-C3</text>
                        <rect x="110" y="180" width="120" height="24" fill="#fff" rx="2" />
                        <text x="170" y="197" fill="#000" fontSize="16" fontWeight="bold" fontFamily="monospace" textAnchor="middle">Super Mini</text>
                        <circle cx="280" cy="180" r="6" fill="#3498db" filter="url(#glow)" />
                        <text x="280" y="200" fill="#3498db" fontSize="12" textAnchor="middle" fontWeight="bold">LED (Pin 8)</text>
                    </g>
                ) : (
                    <>
                        <rect
                            x="190"
                            y="50"
                            width="340"
                            height={boardHeight}
                            rx="40"
                            fill="#1e293b"
                            stroke="#334155"
                            strokeWidth="4"
                        />
                        <rect
                            x="260"
                            y="150"
                            width="200"
                            height="180"
                            rx="20"
                            fill="#334155"
                            stroke="#475569"
                            strokeWidth="2"
                        />
                        <text
                            x="360"
                            y="220"
                            fill="#e2e8f0"
                            textAnchor="middle"
                            fontSize="18"
                            fontWeight="700"
                        >
                            {board.family}
                        </text>
                        <text
                            x="360"
                            y="254"
                            fill="#94a3b8"
                            textAnchor="middle"
                            fontSize="14"
                            fontFamily="monospace"
                        >
                            {board.chipLabel}
                        </text>
                    </>
                )}

                {board.leftPins.map((pin, index) =>
                    renderSvgPin({
                        pin,
                        index,
                        side: "left",
                        assignment: pins.find((mapping) => mapping.gpio_pin === pin.gpio),
                    })
                )}
                {board.rightPins.map((pin, index) =>
                    renderSvgPin({
                        pin,
                        index,
                        side: "right",
                        assignment: pins.find((mapping) => mapping.gpio_pin === pin.gpio),
                    })
                )}
            </svg>

            <div className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur-md border border-slate-700 px-3 py-1.5 rounded-lg text-xs text-slate-300">
                Model: {board.name}
            </div>
        </div>
    );
}
