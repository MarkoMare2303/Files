/**
 * TESTDATEN — NICHT FÜR DEN PRODUKTIVBETRIEB (§49/§56).
 *
 * Verkürzte, aber strukturgetreue OJP-2.0-TripDelivery-Antwort. Dient
 * ausschliesslich dazu, den XML-Parser ohne externen Zugang zu testen.
 */
export const OJP_TRIP_RESPONSE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPResponse>
    <siri:ServiceDelivery>
      <siri:ResponseTimestamp>2025-03-11T16:30:00Z</siri:ResponseTimestamp>
      <OJPTripDelivery>
        <siri:ResponseTimestamp>2025-03-11T16:30:00Z</siri:ResponseTimestamp>
        <TripResult>
          <Id>ID-1</Id>
          <Trip>
            <Id>trip-zh-bs-1</Id>
            <Duration>PT1H3M</Duration>
            <Transfers>0</Transfers>
            <Leg>
              <TimedLeg>
                <LegBoard>
                  <StopPointRef>8503000</StopPointRef>
                  <StopPointName><Text>Zürich HB</Text></StopPointName>
                  <PlannedQuay><Text>32</Text></PlannedQuay>
                  <ServiceDeparture>
                    <TimetabledTime>2025-03-11T16:32:00Z</TimetabledTime>
                    <EstimatedTime>2025-03-11T16:35:00Z</EstimatedTime>
                  </ServiceDeparture>
                </LegBoard>
                <LegIntermediate>
                  <StopPointRef>8500218</StopPointRef>
                  <StopPointName><Text>Olten</Text></StopPointName>
                </LegIntermediate>
                <LegAlight>
                  <StopPointRef>8500010</StopPointRef>
                  <StopPointName><Text>Basel SBB</Text></StopPointName>
                  <PlannedQuay><Text>8</Text></PlannedQuay>
                  <ServiceArrival>
                    <TimetabledTime>2025-03-11T17:35:00Z</TimetabledTime>
                    <EstimatedTime>2025-03-11T17:38:00Z</EstimatedTime>
                  </ServiceArrival>
                </LegAlight>
                <Service>
                  <Mode><PtMode>rail</PtMode></Mode>
                  <PublishedServiceName><Text>IC 3</Text></PublishedServiceName>
                  <DestinationText><Text>Basel SBB</Text></DestinationText>
                  <JourneyRef>ch:1:sjyid:100001:3-001</JourneyRef>
                  <OperatorRef>ch:1:sboid:100001</OperatorRef>
                </Service>
              </TimedLeg>
            </Leg>
          </Trip>
        </TripResult>
        <TripResult>
          <Id>ID-2</Id>
          <Trip>
            <Id>trip-zh-bs-2</Id>
            <Leg>
              <TimedLeg>
                <LegBoard>
                  <StopPointRef>8503000</StopPointRef>
                  <StopPointName><Text>Zürich HB</Text></StopPointName>
                  <ServiceDeparture>
                    <TimetabledTime>2025-03-11T16:58:00Z</TimetabledTime>
                  </ServiceDeparture>
                </LegBoard>
                <LegAlight>
                  <StopPointRef>8500218</StopPointRef>
                  <StopPointName><Text>Olten</Text></StopPointName>
                  <ServiceArrival>
                    <TimetabledTime>2025-03-11T17:25:00Z</TimetabledTime>
                  </ServiceArrival>
                </LegAlight>
                <Service>
                  <Mode><PtMode>rail</PtMode></Mode>
                  <PublishedServiceName><Text>IR 36</Text></PublishedServiceName>
                  <DestinationText><Text>Basel SBB</Text></DestinationText>
                </Service>
              </TimedLeg>
            </Leg>
            <Leg>
              <TransferLeg>
                <TransferType>walk</TransferType>
                <LegStart>
                  <StopPointRef>8500218</StopPointRef>
                  <StopPointName><Text>Olten</Text></StopPointName>
                </LegStart>
                <LegEnd>
                  <StopPointRef>8500218</StopPointRef>
                  <StopPointName><Text>Olten</Text></StopPointName>
                </LegEnd>
                <Duration>PT6M</Duration>
                <TimeWindowStart>2025-03-11T17:25:00Z</TimeWindowStart>
                <TimeWindowEnd>2025-03-11T17:31:00Z</TimeWindowEnd>
              </TransferLeg>
            </Leg>
            <Leg>
              <TimedLeg>
                <LegBoard>
                  <StopPointRef>8500218</StopPointRef>
                  <StopPointName><Text>Olten</Text></StopPointName>
                  <ServiceDeparture>
                    <TimetabledTime>2025-03-11T17:31:00Z</TimetabledTime>
                  </ServiceDeparture>
                </LegBoard>
                <LegAlight>
                  <StopPointRef>8500010</StopPointRef>
                  <StopPointName><Text>Basel SBB</Text></StopPointName>
                  <ServiceArrival>
                    <TimetabledTime>2025-03-11T17:58:00Z</TimetabledTime>
                  </ServiceArrival>
                </LegAlight>
                <Service>
                  <Mode><PtMode>rail</PtMode></Mode>
                  <PublishedServiceName><Text>IC 6</Text></PublishedServiceName>
                  <DestinationText><Text>Basel SBB</Text></DestinationText>
                </Service>
              </TimedLeg>
            </Leg>
          </Trip>
        </TripResult>
      </OJPTripDelivery>
    </siri:ServiceDelivery>
  </OJPResponse>
</OJP>`;
