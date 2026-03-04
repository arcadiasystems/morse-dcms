import { SuiGrpcClient } from "@mysten/sui/grpc";
import { MIST_PER_SUI } from "@mysten/sui/utils";

const MY_ADDRESS =
  "0x6e4f4027f6be7841d5d932929a0095fedceccb762ac5d7d57c236b6839508c07";

const suiClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});

// Convert MIST to Sui
const balance = (balance: { balance: string }) => {
  return Number.parseInt(balance.balance) / Number(MIST_PER_SUI);
};

const mistBalance = await suiClient.getBalance({
  owner: MY_ADDRESS,
});

console.log(`Mist balance: ${balance(mistBalance.balance)} SUI`);
