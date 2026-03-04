import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Activity, Thermometer, Droplets, Zap, Shield, Wifi, Lightbulb, Lock } from "lucide-react"

export default function Home() {
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">IoT Ecosystem Central Dashboard</h1>
                    <p className="text-muted-foreground mt-2">Overview of your connected environment</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-sm border rounded-md px-3 py-1 bg-secondary text-secondary-foreground border-border">
                        Status: Active
                    </div>
                    <div className="text-sm border rounded-md px-3 py-1 border-border">
                        Updated: Just now
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-gradient-to-br from-card to-card/50 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Temperature</CardTitle>
                        <Thermometer className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">72°F</div>
                        <p className="text-xs text-muted-foreground">Living Room Average</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-card to-card/50 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Humidity</CardTitle>
                        <Droplets className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">45%</div>
                        <p className="text-xs text-muted-foreground">Optimal Range</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-card to-card/50 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Energy Usage</CardTitle>
                        <Zap className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">1.2 kW/h</div>
                        <p className="text-xs text-muted-foreground">-4% from yesterday</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-card to-card/50 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">System Health</CardTitle>
                        <Activity className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">100%</div>
                        <p className="text-xs text-muted-foreground">24 Active Devices</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4 bg-black/20 border-border">
                    <CardHeader>
                        <CardTitle>Active Devices Highlights</CardTitle>
                        <CardDescription>Recently interacted components of your smart home</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-4 p-4 border rounded-xl bg-card">
                            <div className="p-3 bg-secondary rounded-full">
                                <Lightbulb className="h-6 w-6 text-yellow-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold">Kitchen Lights</h4>
                                <p className="text-sm text-green-500">On - 80% Brightness</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 p-4 border rounded-xl bg-card">
                            <div className="p-3 bg-secondary rounded-full">
                                <Lock className="h-6 w-6 text-red-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold">Front Door Guard</h4>
                                <p className="text-sm text-muted-foreground">Locked securely</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 p-4 border rounded-xl bg-card">
                            <div className="p-3 bg-secondary rounded-full">
                                <Shield className="h-6 w-6 text-blue-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold">Security System</h4>
                                <p className="text-sm text-green-500">Armed (Stay)</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 p-4 border rounded-xl bg-card">
                            <div className="p-3 bg-secondary rounded-full">
                                <Wifi className="h-6 w-6 text-purple-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold">Main Router</h4>
                                <p className="text-sm text-muted-foreground">5GHz Active - 420 Mbps</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-3 bg-black/20 border-border">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                        <CardDescription>Latest logs from your ecosystem</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex justify-between items-start border-b border-border/50 pb-2">
                                <div>
                                    <p className="text-sm font-medium">Front Door Unlocked</p>
                                    <p className="text-xs text-muted-foreground">Via Keypad Pin</p>
                                </div>
                                <span className="text-xs text-muted-foreground">10:42 AM</span>
                            </div>
                            <div className="flex justify-between items-start border-b border-border/50 pb-2">
                                <div>
                                    <p className="text-sm font-medium">Motion Detected: Garage</p>
                                    <p className="text-xs text-muted-foreground">Camera G-1 triggered</p>
                                </div>
                                <span className="text-xs text-muted-foreground">9:15 AM</span>
                            </div>
                            <div className="flex justify-between items-start border-b border-border/50 pb-2">
                                <div>
                                    <p className="text-sm font-medium">Thermostat Adjusted</p>
                                    <p className="text-xs text-muted-foreground">Set to 72°F (Eco mode)</p>
                                </div>
                                <span className="text-xs text-muted-foreground">8:30 AM</span>
                            </div>
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-sm font-medium">New Device Discovered</p>
                                    <p className="text-xs text-muted-foreground">Smart Plug (Living Room)</p>
                                </div>
                                <span className="text-xs text-muted-foreground">Yesterday</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
