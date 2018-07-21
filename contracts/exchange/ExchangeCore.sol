pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "../lib/ArrayUtils.sol";
import "../lib/ReentrancyGuarded.sol";
import "../registry/ProxyRegistry.sol";
import "../registry/AuthenticatedProxy.sol";

/**
 * @title ExchangeCore
 * @author Wyvern Protocol Developers
 */
contract ExchangeCore is ReentrancyGuarded {

    /* Registry. */
    ProxyRegistry public registry;

    /* Cancelled / finalized orders, by hash. */
    mapping(bytes32 => bool) public cancelledOrFinalized;

    /* Orders verified by on-chain approval (alternative to ECDSA signatures so that smart contracts can place orders directly). */
    mapping(bytes32 => bool) public approvedOrders;

    /* A signature, convenience struct. */
    struct Sig {
        /* v parameter */
        uint8 v;
        /* r parameter */
        bytes32 r;
        /* s parameter */
        bytes32 s;
    }

    /* An order, convenience struct. */
    struct Order {
        /* Exchange contract address (versioning mechanism). */
        address exchange;
        /* Order maker address. */
        address maker;
        /* Order static target. */
        address staticTarget;
        /* Order static extradata. */
        address staticExtradata;
        /* Order listing timestamp. */
        uint listingTime;
        /* Order expiration timestamp - 0 for no expiry. */
        uint expirationTime;
        /* Order salt to prevent duplicate hashes. */
        uint salt;
    }

    /* A call, convenience struct. */
    struct Call {
        /* Target */
        address target;
        /* How to call */
        AuthenticatedProxy.HowToCall howToCall;
        /* Calldata */
        bytes calldata;
    }

    /* Events */
    event OrderApproved   (bytes32 indexed hash);
    event OrderCancelled  (bytes32 indexed hash);
    event OrdersMatched   (bytes32 firstHash, bytes32 secondHash, address indexed firstMaker, address indexed secondMaker, bytes32 indexed metadata);

    function staticCall(address target, bytes memory calldata)
        internal
        view
        returns (bool result)
    {
        assembly {
            result := staticcall(gas, target, add(calldata, 0x20), mload(calldata), mload(0x40), 0)
        }
        return result;
    }

    function hashOrder(Order memory order)
        internal
        pure
        returns (bytes32 hash)
    {
        /* Hash all fields in the order. */
        return keccak256(abi.encodePacked(order.exchange, orer.maker, order.staticTarget, order.staticExtradata, order.listingTime, order.expirationTime, order.salt));
    }

    function hashToSign(bytes32 orderHash)
        internal
        pure
        returns (bytes32 hash)
    {
        /* Calculate the string a user must sign. */
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", orderHash));
    }

    function exists(address what)
        internal
        view
        returns (bool)
    {
        uint size;
        assembly {
            size := extcodesize(what)
        }
        return size > 0;
    }

    function validateOrderParameters(Order memory order)
        internal
        view
        returns (bool)
    {
        /* Order must be targeted at this protocol version (this exchange contract). */
        if (order.exchange != address(this)) {
            return false;
        }

        /* Order must be listed and not be expired. */
        if (order.listingTime > now || order.expirationTime <= now) {
            return false;
        }

        /* Order static target must exist. */
        if (!exists(order.staticTarget)) {
            return false;
        }

        return true;
    }

    function validateOrderAuthorization(bytes32 hash, address maker, Sig memory sig)
        internal
        view
        returns (bool)
    {
        /* Order must not have been cancelled or already filled. */
        if (cancelledOrFinalized[hash]) {
            return false;
        }

        /* Order authentication. Order must be either: */

        /* (a): previously approved */
        if (approvedOrders[hash]) {
            return true;
        }
    
        /* (b): ECDSA-signed by maker. */
        if (ecrecover(hash, sig.v, sig.r, sig.s) == maker) {
            return true;
        }

        return false;
    }

    function executeCall(address maker, Call call)
        internal
        returns (bool)
    {
        /* Retrieve delegate proxy contract. */
        OwnableDelegateProxy delegateProxy = registry.proxies(maker);
      
        /* Assert existence. */
        require(delegateProxy != address(0));

        /* Assert implementation. */
        require(delegateProxy.implementation() == registry.delegateProxyImplementation());
      
        /* Typecast. */
        AuthenticatedProxy proxy = AuthenticatedProxy(delegateProxy);
  
        /* Execute order. */
        return proxy.proxy(call.target, call.howToCall, call.calldata);
    }

    function executeStaticCall(Order memory order, address caller, Call memory call, address counterparty, Call memory countercall, address matcher, uint value)
        internal
        view
        returns (bool)
    {
        return staticCall(order.staticTarget, abi.encodePacked(
            order.staticExtradata,
            caller,
            call.target,
            call.howToCall,
            call.calldata,
            counterparty,
            countercall.target,
            countercall.howToCall,
            countercall.calldata,
            matcher,
            value
        ));
    }

    function atomicMatch(Order memory firstOrder, Sig memory firstSig, Call memory firstCall, Order memory secondOrder, Sig memory secondSig, Call memory secondCall, bytes32 metadata)
        internal
        reentrancyGuard
    {
        /* CHECKS */

        /* Calculate first order hash. */
        bytes32 firstHash = hashOrder(firstOrder);

        /* Check first order validity. */
        require(validateOrderParameters(firstOrder));

        /* Check first order authorization. */
        if (firstOrder.maker != msg.sender) {
            require(validateOrderAuthorization(hashToSign(firstHash), firstOrder.maker, firstSig));
        }

        /* Calculate second order hash. */
        bytes32 secondHash = hashOrder(secondOrder);

        /* Check second order validity. */
        require(validateOrderParameters(secondOrder));

        /* Check second order authorization. */
        if (secondOrder.maker != msg.sender) {
            require(validateOrderAuthorization(hashToSign(secondHash), secondOrder.maker, secondSig));
        }

        /* Prevent self-matching (necessary?). */
        require(firstHash != secondHash);

        /* EFFECTS */ 
  
        /* Mark first order as finalized. */
        if (firstOrder.maker != msg.sender) {
            cancelledOrFinalized[firstHash] = true;
        }

        /* Mark second order as finalized. */
        if (secondOrder.maker != msg.sender) {
            cancelledOrFinalized[secondHash] = true;
        }
        
        /* INTERACTIONS */

        /* Transfer any msg.value. */
        if (msg.value > 0) {
            firstOrder.maker.transfer(msg.value);
        }

        /* Execute first call, assert success. */
        assert(executeCall(firstOrder.maker, firstCall));

        /* Execute second call, assert success. */
        assert(executeCall(secondOrder.maker, secondCall));

        /* Static calls must happen after the effectful calls so that they can check the resulting state. */

        /* Execute first order static call, assert success. */
        assert(executeStaticCall(firstOrder, firstOrder.maker, firstCall, secondOrder.maker, secondCall, msg.sender, msg.value));
      
        /* Execute second order static call, assert success. */
        assert(executeStaticCall(secondOrder, secondOrder.maker, secondCall, firstOrder.maker, firstCall, msg.sender, uint(0)));

        /* Log match event. */
        emit OrdersMatched(firstHash, secondHash, firstOrder.maker, secondOrder.maker, metadata);
    }

}
