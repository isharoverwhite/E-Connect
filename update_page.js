const fs = require('fs');
let content = fs.readFileSync('webapp/src/app/page.tsx', 'utf8');

// 1. Remove weather imports
content = content.replace(
  /import { fetchCurrentHouseTemperature, fetchCurrentWeather, fetchDashboardDevices, fetchDevices, fetchSystemLogs, markSystemLogRead, markAllSystemLogsRead, SystemLogEntry, fetchSystemStatus, SystemStatusResponse, CurrentWeatherResponse, HouseTemperatureResponse, updateHouseholdLocation } from "@\/lib\/api";/,
  `import { fetchCurrentHouseTemperature, fetchDashboardDevices, fetchDevices, fetchSystemLogs, markSystemLogRead, markAllSystemLogsRead, SystemLogEntry, fetchSystemStatus, SystemStatusResponse, HouseTemperatureResponse } from "@/lib/api";`
);

content = content.replace(/import HomeLocationPicker from "@\/components\/HomeLocationPicker";\n/, '');
content = content.replace(/import { HomeLocation } from "@\/lib\/home-location";\n/, '');

// 2. Remove WEATHER_LOCATION_MAX_LENGTH
content = content.replace(/const WEATHER_LOCATION_MAX_LENGTH = 15;\n/, '');

// 3. Remove HomeLocationSetupPrompt
content = content.replace(/function HomeLocationSetupPrompt\([\s\S]*?\}\n\n/m, '');

// 4. Remove states
content = content.replace(/  const \[weatherData, setWeatherData\] = useState<CurrentWeatherResponse \| null>\(null\);\n  const \[weatherLoading, setWeatherLoading\] = useState\(true\);\n  const \[weatherError, setWeatherError\] = useState<string \| null>\(null\);\n/, '');

content = content.replace(/  const \[homeLocationPromptOpen, setHomeLocationPromptOpen\] = useState\(false\);\n  const \[isSavingHomeLocation, setIsSavingHomeLocation\] = useState\(false\);\n/, '');

// 5. Remove loadHomeWeather and handleConfirmHomeLocation
content = content.replace(/  const loadHomeWeather = useCallback\(async \([\s\S]*?\}\n  \}, \[loadHomeWeather\]\);\n\n/m, '');

content = content.replace(/  const handleConfirmHomeLocation = async \([\s\S]*?\}\n  \};\n\n/m, '');

// 6. Remove weatherLocationName
content = content.replace(/  const weatherLocationName = weatherData\?.location_name \|\| "Home Weather";\n  const weatherLocationLabel = truncateLabel\(weatherLocationName, WEATHER_LOCATION_MAX_LENGTH\);\n/m, '');
content = content.replace(/const houseTemperatureSourceLabel = truncateLabel\(houseTemperatureSourceName, WEATHER_LOCATION_MAX_LENGTH\);\n/m, 'const houseTemperatureSourceLabel = truncateLabel(houseTemperatureSourceName, 15);\n');

// 7. Remove HomeLocationSetupPrompt from render
content = content.replace(/      \{homeLocationPromptOpen \? \(\n        <HomeLocationSetupPrompt\n          isOpen=\{homeLocationPromptOpen\}\n          isSaving=\{isSavingHomeLocation\}\n          onConfirm=\{handleConfirmHomeLocation\}\n        \/>\n      \) : null\}\n\n/m, '');

// 8. Replace grid content
const oldGridRegex = /<div className="grid grid-cols-1 gap-6 mb-8 md:grid-cols-2 lg:grid-cols-4">\n\s*<div[\s\S]*?(<div\s+className={`bg-surface-light dark:bg-surface-dark p-6 rounded-xl border relative overflow-hidden group transition-all duration-300 cursor-pointer \${alertCardDynamicClasses}[\s\S]*?)<\/div>\n            <\/div>\n\n            <div className="mb-8">/m;

const gridMatch = content.match(oldGridRegex);

if (gridMatch) {
  console.log("Found grid section");
  
  // Create new grid structure
  const houseTempRegex = /(<div\s+className={`bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 flex flex-col justify-between min-h-\[180px\] \${isAdmin \? "cursor-pointer" : ""}`}[\s\S]*?)(<div\s+className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 cursor-pointer")/m;
  
  const houseTempMatch = content.match(houseTempRegex);
  
  const systemAlertsStr = gridMatch[1];
  
  let newGrid = `<h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-6">E-Connect Overview</h2>
            <div className="grid grid-cols-1 gap-6 mb-8 md:grid-cols-2 lg:grid-cols-4">
              <div
                className="bg-slate-800 p-6 rounded-xl border border-slate-700 hover:border-slate-600 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 cursor-pointer lg:col-span-2 md:col-span-2 flex flex-col justify-between min-h-[180px]"
                onClick={() => router.push("/devices")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push("/devices");
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex items-center gap-2 text-sky-400">
                    <span className="material-icons-round text-xl">devices</span>
                    <h3 className="text-lg font-medium text-slate-200">Device Overview</h3>
                  </div>
                  <div className="flex items-center gap-6 mt-6">
                    <div className="text-6xl font-semibold text-white tracking-tight">{loading ? '--' : devices.length.toString().padStart(2, '0')}</div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="text-base">{loading ? '-' : onlineCount} Online</span>
                      </div>
                      <div className="flex items-center gap-2 text-red-500">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        <span className="text-base">{loading ? '-' : offlineDevices.length} Offline</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className={\`mt-auto pt-4 text-xs flex items-center font-medium \${outdatedDevices.length > 0 ? "text-green-400 animate-[pulse_1.5s_ease-in-out_infinite]" : "text-slate-400"}\`}>
                    <span className="material-icons-round text-sm mr-1">{outdatedDevices.length > 0 ? "system_update" : "trending_up"}</span>
                    {outdatedDevices.length > 0 ? (
                        <div className="flex items-center gap-1">
                            <span>{outdatedDevices.length} update{outdatedDevices.length > 1 ? 's' : ''}</span>
                            <span className="material-icons-round text-[10px]">arrow_forward</span>
                            <span className="font-mono">{latestFirmwareRevision}</span>
                        </div>
                    ) : newThisWeek > 0 ? <span className="text-green-400">{\`+\${newThisWeek} New this week\`}</span> : 'Up to date'}
                  </div>
                </div>
              </div>
              
${houseTempMatch ? houseTempMatch[1].replace(/$/m, '') : ''}
              
              ${systemAlertsStr}
            </div>

            <div className="mb-8">`;
            
    content = content.replace(oldGridRegex, newGrid);
} else {
    console.log("Could not find grid section");
}

fs.writeFileSync('webapp/src/app/page.tsx', content);
