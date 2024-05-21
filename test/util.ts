// import Web3 from "web3";
// // const provider = new Web3.providers.HttpProvider('http://localhost:8545')
// const web3 = new Web3();
// const { defaults } = require("lodash");

import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { eip712Domain, structHash, signHash } from "./eip712";
import { Addressable, BytesLike } from "ethers";

const abiCoder = new ethers.AbiCoder();
// // Truffle does not expose chai so it is impossible to add chai-as-promised.
// // This is a simple replacement function.
// // https://github.com/trufflesuite/truffle/issues/2090
// const assertIsRejected = (promise, error_match, message) => {
//   let passed = false;
//   return promise
//     .then(() => {
//       passed = true;
//       return assert.fail();
//     })
//     .catch((error) => {
//       if (passed)
//         return assert.fail(message || "Expected promise to be rejected");
//       if (error_match) {
//         if (typeof error_match === "string")
//           return assert.equal(error_match, error.message, message);
//         if (error_match instanceof RegExp)
//           return (
//             error.message.match(error_match) ||
//             assert.fail(
//               error.message,
//               error_match.toString(),
//               `'${
//                 error.message
//               }' does not match ${error_match.toString()}: ${message}`
//             )
//           );
//         return assert.instanceOf(error, error_match, message);
//       }
//     });
// };
//
const eip712Order = {
  name: "Order",
  fields: [
    { name: "registry", type: "address" },
    { name: "maker", type: "address" },
    { name: "staticTarget", type: "address" },
    { name: "staticSelector", type: "bytes4" },
    { name: "staticExtradata", type: "bytes" },
    { name: "maximumFill", type: "uint256" },
    { name: "listingTime", type: "uint256" },
    { name: "expirationTime", type: "uint256" },
    { name: "salt", type: "uint256" },
  ],
};

// web3 = web3.extend({
//   methods: [
//     {
//       name: "signTypedData",
//       call: "eth_signTypedData_v4",
//       params: 2,
//       inputFormatter: [web3.extend.formatters.inputAddressFormatter, null],
//     },
//   ],
// });
//
export interface Order {
  registry: string | Addressable;
  maker: string | Addressable;
  staticTarget: string | Addressable;
  staticSelector: string;
  staticExtradata: string;
  maximumFill: number;
  listingTime: number;
  expirationTime: number;
  salt: number;
}

export interface Signature {
  s: string;
  v: number;
  r: string;
  suffix?: string;
}

export interface Call {
  target: string | Addressable;
  howToCall: number;
  data: string;
}

export const hashOrder = (order: Order) => {
  return structHash(eip712Order.name, eip712Order.fields, order);
};

export const structToSign = (order: Order, exchangeContractAddress: string) => {
  return {
    name: eip712Order.name,
    fields: eip712Order.fields,
    domain: {
      name: "Wyvern Exchange",
      version: "3.1",
      chainId: 50,
      verifyingContract: exchangeContractAddress,
    },
    data: order,
  };
};

export const hashToSign = (
  order: Order,
  exchangeContractAddress: string | any
) => {
  // change to Addressable
  return signHash(structToSign(order, exchangeContractAddress));
};

const parseSig = (bytes: string): Signature => {
  bytes = bytes.slice(2);
  const r = "0x" + bytes.slice(0, 64);
  const s = "0x" + bytes.slice(64, 128);
  const v = parseInt("0x" + bytes.slice(128, 130), 16);
  return { v, r, s };
};

export const wrap = (inst) => {
  var obj = {
    inst: inst,
    hashOrder: (order: Order) =>
      inst.hashOrder_(
        order.registry,
        order.maker,
        order.staticTarget,
        order.staticSelector,
        order.staticExtradata,
        order.maximumFill,
        order.listingTime,
        order.expirationTime,
        order.salt
      ),
    hashToSign: async (order: Order) => {
      const hash = await inst.hashOrder_(
        order.registry,
        order.maker,
        order.staticTarget,
        order.staticSelector,
        order.staticExtradata,
        order.maximumFill,
        order.listingTime,
        order.expirationTime,
        order.salt
      );

      return await inst.hashToSign_(hash);
    },
    validateOrderParameters: (order: Order) =>
      inst.validateOrderParameters_(
        order.registry,
        order.maker,
        order.staticTarget,
        order.staticSelector,
        order.staticExtradata,
        order.maximumFill,
        order.listingTime,
        order.expirationTime,
        order.salt
      ),
    validateOrderAuthorization: (hash, maker, sig, misc = {}) =>
      inst.validateOrderAuthorization_(
        hash,
        maker,
        abiCoder.encode(
          ["uint8", "bytes32", "bytes32"],
          [sig.v, sig.r, sig.s]
        ) + (sig.suffix || ""),
        misc
      ),
    approveOrderHash: (hash) => inst.approveOrderHash_(hash),
    approveOrder: (order, inclusion, misc = {}) =>
      inst.approveOrder_(
        order.registry,
        order.maker,
        order.staticTarget,
        order.staticSelector,
        order.staticExtradata,
        order.maximumFill,
        order.listingTime,
        order.expirationTime,
        order.salt,
        inclusion,
        misc
      ),
    setOrderFill: (order: Order, fill: number) =>
      inst.setOrderFill_(hashOrder(order), fill),
    atomicMatch: (
      order: Order,
      sig: Signature,
      call: Call,
      counterorder: Order,
      countersig: Signature,
      countercall: Call,
      metadata: BytesLike
    ) =>
      inst.atomicMatch_(
        [
          order.registry,
          order.maker,
          order.staticTarget,
          order.maximumFill,
          order.listingTime,
          order.expirationTime,
          order.salt,
          call.target,
          counterorder.registry,
          counterorder.maker,
          counterorder.staticTarget,
          counterorder.maximumFill,
          counterorder.listingTime,
          counterorder.expirationTime,
          counterorder.salt,
          countercall.target,
        ],
        [order.staticSelector, counterorder.staticSelector],
        order.staticExtradata,
        call.data,
        counterorder.staticExtradata,
        countercall.data,
        [call.howToCall, countercall.howToCall],
        metadata,
        abiCoder.encode(
          ["bytes", "bytes"],
          [
            abiCoder.encode(
              ["uint8", "bytes32", "bytes32"],
              [sig.v, sig.r, sig.s]
            ) + (sig.suffix || ""),
            abiCoder.encode(
              ["uint8", "bytes32", "bytes32"],
              [countersig.v, countersig.r, countersig.s]
            ) + (countersig.suffix || ""),
          ]
        )
      ),
    atomicMatchWith: (
      order,
      sig,
      call,
      counterorder,
      countersig,
      countercall,
      metadata,
      misc = {}
    ) =>
      inst.atomicMatch_(
        [
          order.registry,
          order.maker,
          order.staticTarget,
          order.maximumFill,
          order.listingTime,
          order.expirationTime,
          order.salt,
          call.target,
          counterorder.registry,
          counterorder.maker,
          counterorder.staticTarget,
          counterorder.maximumFill,
          counterorder.listingTime,
          counterorder.expirationTime,
          counterorder.salt,
          countercall.target,
        ],
        [order.staticSelector, counterorder.staticSelector],
        order.staticExtradata,
        call.data,
        counterorder.staticExtradata,
        countercall.data,
        [call.howToCall, countercall.howToCall],
        metadata,
        abiCoder.encode(
          ["bytes", "bytes"],
          [
            abiCoder.encode(
              ["uint8", "bytes32", "bytes32"],
              [sig.v, sig.r, sig.s]
            ) + (sig.suffix || ""),
            abiCoder.encode(
              ["uint8", "bytes32", "bytes32"],
              [countersig.v, countersig.r, countersig.s]
            ) + (countersig.suffix || ""),
          ]
        ),
        misc
      ),
    sign: async (order: Order, account: HardhatEthersSigner) => {
      const str = structToSign(order, inst.target);
      const sigBytes = await account.signTypedData(
        str.domain,
        {
          Order: eip712Order.fields,
        },
        order
      );

      const sig = parseSig(sigBytes);
      return sig;
    },
    personalSign: async (order: Order, account: HardhatEthersSigner) => {
      const calculatedHashToSign = hashToSign(order, inst.target);

      const sigBytes = await account.provider.send("personal_sign", [
        calculatedHashToSign,
        account.address.toLowerCase(),
      ]);

      const sig = parseSig(sigBytes);

      // sig.v += 27; //needed to remove this for the test to pass
      sig.suffix = "03"; // EthSign suffix like 0xProtocol
      return sig;
    },
  };
  return obj;
};

export const randomUint = () => {
  return Math.floor(Math.random() * 1e10);
};

// const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
export const NULL_SIG = { v: 27, r: ZERO_BYTES32, s: ZERO_BYTES32 };
export const CHAIN_ID = 50;
