#!/bin/sh

rm -rf build/contracts
npx hardhat compile
rm -f yarn-error.log
