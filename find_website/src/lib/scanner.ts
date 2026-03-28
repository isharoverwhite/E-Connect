export type DeviceInfo = {
  ip: string;
  database: string;
  mqtt: string;
  protocol?: string;
  port?: string;
};

// Danh sách các subnet phổ biến của các dòng Modem/Router
export const COMMON_SUBNETS = [
  // Phổ biến nhất (VNPT, Viettel, FPT, TP-Link, Tenda, Linksys)
  "192.168.1",
  "192.168.0",
  "10.0.0",
  // Mesh & Router đời mới
  "192.168.68",  // TP-Link Deco Mesh
  "192.168.50",  // Asus Router đời mới
  "192.168.31",  // Xiaomi Router
  "192.168.88",  // MikroTik
  // Các Modem nhà mạng chuyên biệt (ZTE, Huawei GPON, Viettel)
  "192.168.100", 
  "192.168.8",
  "192.168.2",   // Belkin / Một số thiết bị cũ
  // Dải 10.x.x.x
  "10.10.10"
];

export const generateSubnetIps = (subnetPrefix: string): string[] => {
  const ips: string[] = [];
  for (let i = 1; i < 255; i++) {
    ips.push(`${subnetPrefix}.${i}`);
  }
  return ips;
};
