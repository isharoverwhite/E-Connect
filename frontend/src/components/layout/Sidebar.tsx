import Link from "next/link"
import { LayoutDashboard, Settings, Layers, Workflow, Server } from "lucide-react"

export function Sidebar() {
    return (
        <div className="w-64 border-r bg-card h-screen flex flex-col">
            <div className="p-6">
                <h2 className="text-2xl font-bold tracking-tight">IoT Central</h2>
                <p className="text-sm text-muted-foreground mt-1">Status: All Systems Normal</p>
            </div>

            <nav className="flex-1 px-4 space-y-2">
                <Link href="/" className="flex items-center gap-3 px-3 py-2 rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/80">
                    <LayoutDashboard className="h-5 w-5" />
                    Dashboard
                </Link>
                <Link href="/analytics" className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground">
                    <Layers className="h-5 w-5" />
                    Analytics & Reports
                </Link>
                <Link href="/devices" className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground">
                    <Server className="h-5 w-5" />
                    Device Management
                </Link>
                <Link href="/automation" className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground">
                    <Workflow className="h-5 w-5" />
                    Automation & Scripts
                </Link>
                <Link href="/extensions" className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground">
                    <Settings className="h-5 w-5" />
                    Extensions
                </Link>
            </nav>

            <div className="p-4 border-t">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                        US
                    </div>
                    <div>
                        <p className="text-sm font-medium">Admin User</p>
                        <p className="text-xs text-muted-foreground">admin@local.host</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
