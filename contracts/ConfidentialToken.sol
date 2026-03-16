// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FHE, euint32, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract ConfidentialToken {
    string  public name;
    string  public symbol;
    uint8   public decimals;
    address public immutable owner;
    uint256 public totalSupply;

    mapping(address => euint32) private _balances;
    mapping(address => mapping(address => euint32)) private _allowances;

    event Transfer(address indexed from, address indexed to);
    event Approval(address indexed owner, address indexed spender);
    event Mint(address indexed to);
    event Burn(address indexed from);

    error OnlyOwner();

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name; symbol = _symbol; decimals = _decimals; owner = msg.sender;
        euint32 zero = FHE.asEuint32(0);
        FHE.allowThis(zero); FHE.allow(zero, msg.sender);
        _balances[msg.sender] = zero;
    }

    modifier onlyOwner() { if (msg.sender != owner) revert OnlyOwner(); _; }

    function _initBalance(address addr) internal {
        if (euint32.unwrap(_balances[addr]) == 0) {
            euint32 zero = FHE.asEuint32(0);
            FHE.allowThis(zero); FHE.allow(zero, addr);
            _balances[addr] = zero;
        }
    }

    function mint(address to, InEuint32 memory encryptedAmount) external onlyOwner {
        _initBalance(to);
        euint32 amount = FHE.asEuint32(encryptedAmount);
        FHE.allowThis(amount);
        euint32 newBal = FHE.add(_balances[to], amount);
        FHE.allowThis(newBal); FHE.allow(newBal, to);
        _balances[to] = newBal;
        totalSupply++;
        emit Mint(to);
    }

    function transfer(address to, InEuint32 memory encryptedAmount) external returns (bool) {
        _initBalance(to);
        euint32 amount = FHE.asEuint32(encryptedAmount);
        FHE.allowThis(amount);
        euint32 senderBal = _balances[msg.sender];
        euint32 zero = FHE.asEuint32(0); FHE.allowThis(zero);
        euint32 actual = FHE.select(FHE.gte(senderBal, amount), amount, zero);
        FHE.allowThis(actual);
        euint32 newSender = FHE.sub(senderBal, actual);
        FHE.allowThis(newSender); FHE.allow(newSender, msg.sender);
        _balances[msg.sender] = newSender;
        euint32 newRecip = FHE.add(_balances[to], actual);
        FHE.allowThis(newRecip); FHE.allow(newRecip, to);
        _balances[to] = newRecip;
        emit Transfer(msg.sender, to);
        return true;
    }

    function approve(address spender, InEuint32 memory encryptedAmount) external returns (bool) {
        euint32 amount = FHE.asEuint32(encryptedAmount);
        FHE.allowThis(amount); FHE.allow(amount, spender); FHE.allow(amount, msg.sender);
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender);
        return true;
    }

    function transferFrom(address from, address to, InEuint32 memory encryptedAmount) external returns (bool) {
        _initBalance(to);
        euint32 amount = FHE.asEuint32(encryptedAmount); FHE.allowThis(amount);
        euint32 fromBal = _balances[from];
        euint32 allowance = _allowances[from][msg.sender];
        euint32 zero = FHE.asEuint32(0); FHE.allowThis(zero);
        euint32 actual = FHE.select(
            FHE.and(FHE.gte(fromBal, amount), FHE.gte(allowance, amount)),
            amount, zero
        );
        FHE.allowThis(actual);
        euint32 newFrom = FHE.sub(fromBal, actual);
        FHE.allowThis(newFrom); FHE.allow(newFrom, from); _balances[from] = newFrom;
        euint32 newAllow = FHE.sub(allowance, actual);
        FHE.allowThis(newAllow); FHE.allow(newAllow, from); FHE.allow(newAllow, msg.sender);
        _allowances[from][msg.sender] = newAllow;
        euint32 newTo = FHE.add(_balances[to], actual);
        FHE.allowThis(newTo); FHE.allow(newTo, to); _balances[to] = newTo;
        emit Transfer(from, to);
        return true;
    }

    function burn(InEuint32 memory encryptedAmount) external {
        euint32 amount = FHE.asEuint32(encryptedAmount); FHE.allowThis(amount);
        euint32 bal = _balances[msg.sender];
        euint32 zero = FHE.asEuint32(0); FHE.allowThis(zero);
        euint32 actual = FHE.select(FHE.gte(bal, amount), amount, zero);
        FHE.allowThis(actual);
        euint32 newBal = FHE.sub(bal, actual);
        FHE.allowThis(newBal); FHE.allow(newBal, msg.sender);
        _balances[msg.sender] = newBal;
        emit Burn(msg.sender);
    }

    function balanceOf(address account) external view returns (euint32) { return _balances[account]; }
    function allowance(address tokenOwner, address spender) external view returns (euint32) { return _allowances[tokenOwner][spender]; }
}
