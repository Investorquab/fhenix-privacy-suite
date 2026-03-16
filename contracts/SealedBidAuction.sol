// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FHE, euint32, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract SealedBidAuction {
    address public immutable owner;
    uint256 public immutable deadline;
    string  public itemDescription;
    bool    public finalized;
    address public winner;

    mapping(address => euint32) private encryptedBids;
    mapping(address => bool)    public  hasBid;
    address[]                   private bidders;
    euint32 private encryptedHighestBid;

    event BidPlaced(address indexed bidder);
    event AuctionFinalized(address indexed winner);

    error AuctionEnded();
    error AuctionNotEnded();
    error AlreadyFinalized();
    error AlreadyBid();

    constructor(uint256 durationSeconds, string memory _itemDescription) {
        owner           = msg.sender;
        deadline        = block.timestamp + durationSeconds;
        itemDescription = _itemDescription;
    }

    modifier onlyWhileActive() {
        if (block.timestamp >= deadline) revert AuctionEnded();
        _;
    }
    modifier onlyAfterDeadline() {
        if (block.timestamp < deadline) revert AuctionNotEnded();
        _;
    }

    function placeBid(InEuint32 memory _encryptedBid) external onlyWhileActive {
        if (hasBid[msg.sender]) revert AlreadyBid();
        euint32 bid = FHE.asEuint32(_encryptedBid);
        FHE.allowThis(bid);
        FHE.allowSender(bid);
        encryptedBids[msg.sender] = bid;
        hasBid[msg.sender]        = true;
        bidders.push(msg.sender);
        emit BidPlaced(msg.sender);
    }

    function finalize() external onlyAfterDeadline {
        if (finalized) revert AlreadyFinalized();
        require(bidders.length > 0, "No bids");

        euint32 highestBid = encryptedBids[bidders[0]];
        address leader     = bidders[0];

        for (uint256 i = 1; i < bidders.length; i++) {
            euint32 challenger = encryptedBids[bidders[i]];
            euint32 newMax = FHE.select(FHE.gt(challenger, highestBid), challenger, highestBid);
            FHE.allowThis(newMax);
            highestBid = newMax;
            leader = bidders[i];
        }

        winner    = leader;
        finalized = true;
        FHE.allow(highestBid, winner);
        FHE.allowThis(highestBid);
        encryptedHighestBid = highestBid;
        emit AuctionFinalized(winner);
    }

    function getEncryptedWinningBid() external view returns (euint32) {
        require(finalized, "Not finalized");
        return encryptedHighestBid;
    }

    function getAuctionInfo() external view returns (
        string memory, uint256, bool, address, uint256
    ) {
        return (itemDescription, deadline, finalized, winner, bidders.length);
    }

    function timeRemaining() external view returns (uint256) {
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }
}
