#!/bin/sh

rm -rf build
npx hardhat test $1
