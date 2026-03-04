export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden">
            {/* Background decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold tracking-tight">IoT Central</h1>
                    <p className="text-muted-foreground mt-2">Smart Home Ecosystem</p>
                </div>

                {children}

                <p className="mt-8 text-center text-xs text-muted-foreground">
                    &copy; {new Date().getFullYear()} IoT Ecosystem Central Dashboard. All rights reserved.
                </p>
            </div>
        </div>
    )
}
